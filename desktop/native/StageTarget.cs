using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// Win32 observer scoped to one drag. A validated taskbar hover can restore
// and activate the bound AN window after the manager acknowledges handoff.
// No SendInput, hooks, OLE, clipboard writes or document/file modification.
internal static class StageTarget {
  [StructLayout(LayoutKind.Sequential)] internal struct Point { internal int X; internal int Y; }
  [DllImport("user32.dll")] private static extern bool GetPhysicalCursorPos(out Point point);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPhysicalPoint(Point point);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr hwnd, ref Point point);
  [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd,int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder value, int size);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder value, ref int length);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr value);
  [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int Left; internal int Top; internal int Right; internal int Bottom; }
  private static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
  private static readonly object ApprovalLock=new object();
  private static Dictionary<string,object> Approval;

  private static void EnablePerMonitorDpi() {
    // GetPhysicalCursorPos is expressed in physical pixels. Make the helper
    // per-monitor aware so GetClientRect/ScreenToClient use the same space.
    // The fallback is needed on older Windows versions where the v2 API is absent.
    try { if(SetProcessDpiAwarenessContext(new IntPtr(-4)))return; } catch(EntryPointNotFoundException) {}
    try { if(SetProcessDpiAwareness(2)==0)return; } catch(DllNotFoundException) {} catch(EntryPointNotFoundException) {}
    SetProcessDPIAware();
  }

  private static string Executable(uint pid) {
    var process=OpenProcess(0x1000,false,pid);
    if(process==IntPtr.Zero)return "";
    try { var b=new StringBuilder(32768);int length=b.Capacity;return QueryFullProcessImageName(process,0,b,ref length)?b.ToString():""; }
    finally { CloseHandle(process); }
  }
  private static Dictionary<string,object> Describe(IntPtr handle,bool withExecutable) {
    uint pid;GetWindowThreadProcessId(handle,out pid);var name=new StringBuilder(256);GetClassName(handle,name,name.Capacity);
    return new Dictionary<string,object> { {"hwnd",handle.ToInt64().ToString(CultureInfo.InvariantCulture)}, {"pid",pid}, {"className",name.ToString()}, {"enabled",IsWindowEnabled(handle)}, {"visible",IsWindowVisible(handle)}, {"exe",withExecutable?Executable(pid):""} };
  }
  private static bool IsClientPoint(IntPtr root,Point physical) {
    Rect rect;if(!GetClientRect(root,out rect))return false;
    Point client=physical;if(!ScreenToClient(root,ref client))return false;
    return client.X>=rect.Left&&client.X<rect.Right&&client.Y>=rect.Top&&client.Y<rect.Bottom;
  }
  private static Dictionary<string,object> Snapshot(string phase) {
    Point p;if(!GetPhysicalCursorPos(out p))return Error(phase,"cursor-unavailable");
    var hit=WindowFromPhysicalPoint(p);var root=GetAncestor(hit,2);
    if(hit==IntPtr.Zero||root==IntPtr.Zero)return Error(phase,"no-window");
    var chain=new List<Dictionary<string,object>>();
    for(var current=hit;current!=IntPtr.Zero&&chain.Count<32;current=GetParent(current))chain.Add(Describe(current,false));
    return new Dictionary<string,object> { {"phase",phase}, {"ok",true}, {"x",p.X}, {"y",p.Y}, {"buttonDown",(GetAsyncKeyState(1)&0x8000)!=0}, {"observedAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}, {"clientArea",IsClientPoint(root,p)}, {"root",Describe(root,true)}, {"ancestors",chain} };
  }

  // UI Automation identifies the taskbar button by the exact AppUserModelID
  // path. We require the known Animate PID and executable path before any
  // foreground change; a name-only or arbitrary taskbar hit is rejected.
  private static bool TryAnimateTaskbarHover(Point physical,uint targetPid,out Dictionary<string,object> host) {
    host=null;
    try {
      var hit=WindowFromPhysicalPoint(physical);var root=GetAncestor(hit,2);var taskbarClass=GetWindowClass(root);
      if(taskbarClass!="Shell_TrayWnd"&&taskbarClass!="Shell_SecondaryTrayWnd")return false;
      using(var process=Process.GetProcessById((int)targetPid)) {
      if(process.HasExited)return false;
      var exe=Executable(targetPid);if(String.IsNullOrEmpty(exe)||!String.Equals(Path.GetFileName(exe),"Animate.exe",StringComparison.OrdinalIgnoreCase))return false;
      var taskbar=AutomationElement.FromHandle(root);var buttons=taskbar.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));
      for(int i=0;i<buttons.Count;i++) {
        var info=buttons[i].Current;
        if(info.IsOffscreen||!info.BoundingRectangle.Contains(physical.X,physical.Y))continue;
        if(info.ClassName==null||info.ClassName.IndexOf("TaskListButton",StringComparison.OrdinalIgnoreCase)<0)continue;
        var expected="Appid: "+exe;if(!String.Equals(info.AutomationId,expected,StringComparison.OrdinalIgnoreCase))return false;
        var hwnd=process.MainWindowHandle;if(hwnd==IntPtr.Zero)return false;uint owner;GetWindowThreadProcessId(hwnd,out owner);if(owner!=targetPid)return false;
        var hostClass=GetWindowClass(hwnd);if(!hostClass.StartsWith("Adobe Animate",StringComparison.OrdinalIgnoreCase)||!IsWindowEnabled(hwnd)||!IsWindowVisible(hwnd))return false;
        host=new Dictionary<string,object>{{"hwnd",hwnd.ToInt64().ToString(CultureInfo.InvariantCulture)},{"pid",targetPid},{"className",hostClass},{"enabled",true},{"visible",true},{"exe",exe}};return true;
      }
      }
    } catch {}
    return false;
  }
  private static string GetWindowClass(IntPtr hwnd) { var name=new StringBuilder(256);GetClassName(hwnd,name,name.Capacity);return name.ToString(); }
  private static bool ActivateAnimate(uint targetPid,IntPtr expectedHwnd) {
    try {
      using(var process=Process.GetProcessById((int)targetPid)) {
        if(process.HasExited)return false;
        var hwnd=process.MainWindowHandle;
        if(hwnd==IntPtr.Zero||hwnd!=expectedHwnd||!IsWindowEnabled(hwnd))return false;
        uint owner;GetWindowThreadProcessId(hwnd,out owner);if(owner!=targetPid)return false;
        var exe=Executable(targetPid);if(!String.Equals(Path.GetFileName(exe),"Animate.exe",StringComparison.OrdinalIgnoreCase))return false;
        if(IsIconic(hwnd))ShowWindowAsync(hwnd,9);
        return SetForegroundWindow(hwnd);
      }
    }catch{return false;}
  }
  private static uint UniqueAnimatePid() {
    var pids=new List<int>();foreach(var process in Process.GetProcessesByName("Animate")){try{if(!process.HasExited)pids.Add(process.Id);}catch{}finally{process.Dispose();}}
    return pids.Count==1?(uint)pids[0]:0;
  }
  private static void ReadApprovals() {
    var serializer=new JavaScriptSerializer();
    try {
      string line;
      while((line=Console.ReadLine())!=null){
        if(line.Length>1024)continue;
        var message=serializer.DeserializeObject(line) as Dictionary<string,object>;
        if(message==null||!message.ContainsKey("phase")||!String.Equals(Convert.ToString(message["phase"]),"approve-host",StringComparison.Ordinal))continue;
        lock(ApprovalLock){Approval=message;}
      }
    }catch{}
  }
  private static object InspectTaskbar() {
    var matches=new List<object>();var targetPid=UniqueAnimatePid();
    if(targetPid==0)return new Dictionary<string,object>{{"phase","inspect"},{"ok",true},{"animatePid",0},{"matches",matches}};
    var taskbars=AutomationElement.RootElement.FindAll(TreeScope.Children,new OrCondition(
      new PropertyCondition(AutomationElement.ClassNameProperty,"Shell_TrayWnd"),new PropertyCondition(AutomationElement.ClassNameProperty,"Shell_SecondaryTrayWnd")));
    foreach(AutomationElement taskbar in taskbars) {
      var buttons=taskbar.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));
      foreach(AutomationElement button in buttons) {
        var info=button.Current;if(info.IsOffscreen||info.BoundingRectangle.IsEmpty||!String.Equals(info.AutomationId,"Appid: "+Executable(targetPid),StringComparison.OrdinalIgnoreCase))continue;
        var rectangle=info.BoundingRectangle;var point=new Point{X=(int)(rectangle.Left+rectangle.Width/2),Y=(int)(rectangle.Top+rectangle.Height/2)};
        Dictionary<string,object> host;
        var matched=TryAnimateTaskbarHover(point,targetPid,out host);
        if(matched)matches.Add(new Dictionary<string,object>{{"automationId",info.AutomationId},{"x",point.X},{"y",point.Y},{"host",host}});
      }
    }
    return new Dictionary<string,object>{{"phase","inspect"},{"ok",true},{"animatePid",targetPid},{"matches",matches}};
  }
  private static Dictionary<string,object> Error(string phase,string reason) {
    return new Dictionary<string,object> { {"phase",phase}, {"ok",false}, {"reason",reason}, {"observedAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()} };
  }
  private static void Write(object value) { Console.WriteLine(Json.Serialize(value));Console.Out.Flush(); }
  private static int Main(string[] args) {
    try {
      EnablePerMonitorDpi();
      if(args.Length==1&&args[0]=="inspect") { Write(Snapshot("inspect"));return 0; }
      if(args.Length==1&&args[0]=="taskbar-inspect") { Write(InspectTaskbar());return 0; }
      if(args.Length==1&&args[0]=="animate-pids") {
        var pids=new List<int>();foreach(var process in Process.GetProcessesByName("Animate")){try{if(!process.HasExited)pids.Add(process.Id);}catch{}finally{process.Dispose();}}
        pids.Sort();Write(new Dictionary<string,object>{{"phase","inspect"},{"ok",true},{"animatePids",pids}});return 0;
      }
      ulong expected;int ttl;
      uint targetPid=0; if(args.Length!=4||args[0]!="watch"||!ulong.TryParse(args[1],out expected)||expected==0||!int.TryParse(args[2],out ttl)||ttl<1000||ttl>30000||!uint.TryParse(args[3],out targetPid)) return 2;
      var initial=Snapshot("started");
      if(!(bool)initial["ok"]) { Write(initial);return 0; }
      var root=(Dictionary<string,object>)initial["root"];
      if(!(bool)initial["buttonDown"]||root["hwnd"].ToString()!=expected.ToString(CultureInfo.InvariantCulture)||!(bool)root["enabled"]||!(bool)root["visible"]) { Write(Error("started","invalid-source-gesture"));return 0; }
      if(targetPid==0)targetPid=UniqueAnimatePid();
      Write(initial);
      var clock=Stopwatch.StartNew();int hoverId=0;long hoverSince=-1,lastSample=-120,reportedAt=0;IntPtr hoverHwnd=IntPtr.Zero;bool hoverReported=false;
      var approvalThread=new Thread(ReadApprovals);approvalThread.IsBackground=true;approvalThread.Start();
      while(clock.ElapsedMilliseconds<ttl) {
        if((GetAsyncKeyState(0x1b)&0x8000)!=0) { Write(Error("released","escape"));return 0; }
        if((GetAsyncKeyState(1)&0x8000)==0) { Write(Snapshot("released"));return 0; }
        Dictionary<string,object> approval;lock(ApprovalLock){approval=Approval;Approval=null;}
        if(approval!=null&&hoverReported&&clock.ElapsedMilliseconds-reportedAt<1500) {
          uint approvalPid;long approvalHwnd;int approvalId;
          Point currentPoint;Dictionary<string,object> currentHost;
          if(approval.ContainsKey("pid")&&approval.ContainsKey("hwnd")&&approval.ContainsKey("hoverId")
            &&UInt32.TryParse(Convert.ToString(approval["pid"]),out approvalPid)&&Int64.TryParse(Convert.ToString(approval["hwnd"]),out approvalHwnd)&&Int32.TryParse(Convert.ToString(approval["hoverId"]),out approvalId)
            &&approvalPid==targetPid&&approvalId==hoverId&&approvalHwnd==hoverHwnd.ToInt64()
            &&GetPhysicalCursorPos(out currentPoint)&&TryAnimateTaskbarHover(currentPoint,targetPid,out currentHost)
            &&Convert.ToInt64(currentHost["hwnd"])==approvalHwnd&&(GetAsyncKeyState(1)&0x8000)!=0&&(GetAsyncKeyState(0x1b)&0x8000)==0)
            ActivateAnimate(targetPid,hoverHwnd);
        }
        if(targetPid>0&&!hoverReported&&clock.ElapsedMilliseconds-lastSample>=120) {
          lastSample=clock.ElapsedMilliseconds;Point taskbarPoint;Dictionary<string,object> taskbar;
          if(GetPhysicalCursorPos(out taskbarPoint)&&TryAnimateTaskbarHover(taskbarPoint,targetPid,out taskbar)) {
            var candidate=new IntPtr(Convert.ToInt64(taskbar["hwnd"]));
            if(hoverHwnd!=candidate){hoverHwnd=candidate;hoverSince=clock.ElapsedMilliseconds;}
            else if(hoverSince>=0&&clock.ElapsedMilliseconds-hoverSince>=600) {
              hoverId++;hoverReported=true;reportedAt=clock.ElapsedMilliseconds;
              Write(new Dictionary<string,object>{{"phase","host-hover"},{"ok",true},{"taskbar",true},{"buttonDown",true},{"hoverId",hoverId},{"x",taskbarPoint.X},{"y",taskbarPoint.Y},{"observedAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()},{"host",taskbar}});
            }
          }else{hoverHwnd=IntPtr.Zero;hoverSince=-1;}
        }
        Thread.Sleep(16);
      }
      Write(Error("released","timeout"));return 0;
    } catch { Write(Error("released","native-error"));return 1; }
  }
}
