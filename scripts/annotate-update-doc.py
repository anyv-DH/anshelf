# Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE.
"""Annotate isolated update-check UI captures; no user library is captured."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT = Path('C:/Windows/Fonts/msyh.ttc')
BOLD = Path('C:/Windows/Fonts/msyhbd.ttc')

def font(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), size)

def build():
    scale = 2
    image = Image.new('RGB', (1440 * scale, 1080 * scale), '#f5f0fa')
    draw = ImageDraw.Draw(image)
    def box(rect, fill, radius=18, outline=None, width=1):
        draw.rounded_rectangle(tuple(int(v*scale) for v in rect), radius=radius*scale, fill=fill, outline=outline, width=width*scale)
    def text(x, y, value, size=20, fill='#44324f', bold=False):
        draw.text((x*scale,y*scale), value, font=font(size*scale,bold), fill=fill)
    def paste(source, x, y, width):
        source = source.resize((width*scale, round(source.height*width/source.width)*scale), Image.Resampling.LANCZOS)
        image.paste(source, (x*scale,y*scale))
    def callout(n, title, lines, x, y, tx, ty, width=300):
        draw.line([(tx*scale,ty*scale),(x*scale,(y+32)*scale)],fill='#b291d6',width=3*scale)
        box((x,y,x+width,y+106),'#fffaff',outline='#dfd0ed')
        draw.ellipse(((tx-14)*scale,(ty-14)*scale,(tx+14)*scale,(ty+14)*scale),fill='#a17bc7',outline='#ffffff',width=2*scale)
        text(tx-5,ty-12,str(n),16,'#ffffff',True)
        text(x+16,y+12,title,20,bold=True)
        for i,line in enumerate(lines): text(x+16,y+47+i*24,line,16,'#80688e')

    box((25,25,1415,1055),'#faf7fd',radius=30)
    text(55,50,'新版来了，安安会提醒您',34,bold=True)
    text(57,103,'只检查版本，不打扰找素材；什么时候更新，由您决定。',19,'#8c769d')
    text(58,165,'① 左下角，一眼看到新版',21,bold=True)
    entry = Image.open(ROOT/'test-output/update-entry.png').convert('RGB')
    paste(entry,65,212,260)
    box((56,505,333,630),'#eee5f7')
    text(74,522,'启动时只检查一次',21,bold=True)
    text(74,563,'不会反复刷新或自动安装。',16,'#80688e')
    text(74,590,'离线也能照常使用素材库。',16,'#80688e')

    dialog = Image.open(ROOT/'test-output/update-dialog.png').convert('RGB')
    targets = json.loads((ROOT/'test-output/update-doc-targets.json').read_text(encoding='utf-8'))
    preview_x, preview_y, preview_width = 386, 168, 621
    paste(dialog, preview_x, preview_y, preview_width)
    ratio = preview_width / dialog.width
    def point(selector):
        target = targets[selector]
        return preview_x + target['x'] * ratio, preview_y + target['y'] * ratio
    callout(2,'当前版本 / 最新版本',['点入口后查看版本信息，','照着中文步骤更新即可。'],1050,230,*point('#update-status'))
    callout(3,'自动检查，可以关闭',['取消勾选后，下次启动','不再发起版本检查。'],1050,460,*point('#update-auto-check'))
    callout(4,'只去官方下载页',['手动下载安装版或免安装版；','插件有改动时，单独更新。'],1050,655,*point('[data-action="open-update-page"]'))
    callout(5,'作者与开源主页',['点击 GitHub 地址，了解项目；','喜欢安安，欢迎点一颗 Star。'],1050,850,*point('[data-action="open-project-page"]'))
    text(72,977,'小提醒：使用同一个 Windows 账号更新，原素材库与分类会继续保留。',22,bold=True)
    text(72,1019,'图中版本为演示数据：当前 v0.3.8 / 示例新版 v0.3.9，不代表 v0.3.9 已经发布。',16,'#9b87a9')
    destination = ROOT/'docs/images/annotated-updates.png'
    image.resize((1440,1080),Image.Resampling.LANCZOS).save(destination,optimize=True)
    print(destination)

if __name__ == '__main__':
    build()
