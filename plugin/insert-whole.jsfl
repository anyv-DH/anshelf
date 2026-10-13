/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
/** AnShelf guarded receiver. Only a validated managed FLA temporary copy is opened.
 * Native Animate compatibility is verified separately for each supported host.
 */
function AnShelfInsertWhole(requestJson, trustedRootURI) {
    var target = null, source = null, oldLayer = 0, oldFrame = 0, request = null;
    var result = { version: 1, ok: false };
    try {
        request = AnShelfParseJSON(requestJson);
        AnShelfValidateRequest(request, trustedRootURI);
        result.requestId = request.requestId;
        result.assetId = request.asset.id;
        var prefix = "AnShelf/" + request.asset.hash;
        var rootName = prefix + "/whole";
        var activeTarget = fl.getDocumentDOM();
        if (!activeTarget) throw new Error("请先打开要插入素材的 AN 文档");
        if (request.delivery === "stage-drop" && activeTarget.id !== request.targetDocumentId) throw new Error("拖拽目标文档已切换或关闭，请回到原文档重新拖入");
        target = activeTarget;
        var targetTimeline = AnShelfStageTimeline(target);
        oldLayer = targetTimeline.currentLayer;
        oldFrame = targetTimeline.currentFrame;
        var stageCenter = { x: target.width / 2, y: target.height / 2 };
        var targetLayer = targetTimeline.layers[oldLayer];
        if (!targetLayer || targetLayer.locked || targetLayer.visible === false) throw new Error("当前图层已锁定或隐藏，请选择可编辑图层");
        if (targetLayer.layerType && targetLayer.layerType !== "normal") throw new Error("请选择普通图层插入素材");
        var rootItem = AnShelfFindItem(target.library, rootName);
        if (rootItem) {
            AnShelfPrepareFrame(targetTimeline, oldLayer, oldFrame);
            target.selectNone();
            if (target.addItem(stageCenter, rootItem) === false) throw new Error("已有素材元件放置失败");
            AnShelfCenterSelection(target, stageCenter);
            result.reused = true;
            result.frameCount = rootItem.timeline ? rootItem.timeline.frameCount : 0;
        } else {
            for (var q = 0; q < target.library.items.length; q++) {
                if (target.library.items[q].name.indexOf(prefix + "/") === 0) throw new Error("目标库存在未完成的同素材导入，请先整理该素材命名空间");
            }
            var openedSource = fl.openDocument(request.temporaryURI);
            if (!openedSource || openedSource === target) throw new Error("无法打开素材 FLA 临时副本");
            if (!openedSource.pathURI || AnShelfURI(openedSource.pathURI) !== AnShelfURI(request.temporaryURI)) throw new Error("AN 打开的文档不是请求的素材临时副本");
            source = openedSource;
            AnShelfNamespaceLibrary(source.library, prefix + "/source");
            var scenes = AnShelfCollectScenes(source, prefix);
            rootItem = AnShelfBuildRoot(source, prefix, scenes);
            source.editScene(0);
            var transferTimeline = source.getTimeline();
            var transferLayer = transferTimeline.addNewLayer("__AnShelf_transfer", "normal", true);
            transferTimeline.currentLayer = transferLayer;
            transferTimeline.currentFrame = 0;
            source.selectNone();
            if (source.addItem(stageCenter, rootItem) === false) throw new Error("素材总元件创建失败");
            AnShelfCenterSelection(source, stageCenter);
            source.clipCopy();
            fl.setActiveWindow(target);
            AnShelfPrepareFrame(targetTimeline, oldLayer, oldFrame);
            target.selectNone();
            target.clipPaste(true);
            AnShelfCenterSelection(target, stageCenter);
            if (!target.library.itemExists(rootName)) throw new Error("AN 未返回预期元件；请检查目标库，当前文件尚未自动保存");
            result.reused = false;
            result.sceneCount = scenes.length;
            result.frameCount = rootItem.timeline.frameCount;
            if (source.frameRate && target.frameRate && source.frameRate !== target.frameRate) result.warning = "素材与目标帧率不同，播放时长按目标文档帧率计算";
        }
        result.ok = true;
        result.rootSymbol = rootName;
        result.message = "已插入当前舞台，元件可继续编辑";
    } catch (error) {
        result.error = String(error.message || error);
    } finally {
        if (source && source !== target) {
            try { source.close(false); } catch (closeError) { result.warning = "素材临时文档未能关闭，请手动关闭且不要保存"; }
        }
        if (target) {
            try {
                fl.setActiveWindow(target);
                target.getTimeline().currentLayer = oldLayer;
                target.getTimeline().currentFrame = oldFrame;
            } catch (restoreError) { result.warning = "请切回原目标文档检查插入结果"; }
        }
    }
    return AnShelfJSON(result);
}

function AnShelfStageTimeline(doc) {
    for (var depth = 0; depth < 64; depth++) {
        var current = doc.getTimeline();
        for (var s = 0; s < doc.timelines.length; s++) if (doc.timelines[s] === current) return current;
        doc.exitEditMode();
    }
    throw new Error("无法退出元件编辑模式，请手动返回当前场景舞台再插入");
}

function AnShelfPrepareFrame(timeline, layer, frame) {
    timeline.currentLayer = layer;
    var cell = timeline.layers[layer].frames[frame];
    if (!cell) throw new Error("目标帧不存在");
    timeline.currentFrame = frame;
    if (cell.startFrame !== frame) timeline.insertKeyframe(frame);
}

function AnShelfCenterSelection(doc, center) {
    if (!doc.selection || !doc.selection.length) throw new Error("AN 未选中已放置的素材元件");
    var item = doc.selection[0];
    var values = [item.left, item.top, item.width, item.height, item.x, item.y, center.x, center.y];
    for (var i = 0; i < values.length; i++) if (typeof values[i] !== "number" || !isFinite(values[i])) throw new Error("AN 返回的素材位置或边界无效");
    var nextX = item.x + center.x - (item.left + item.width / 2);
    var nextY = item.y + center.y - (item.top + item.height / 2);
    if (!isFinite(nextX) || !isFinite(nextY)) throw new Error("素材居中位置无效");
    item.x = nextX;
    item.y = nextY;
}

function AnShelfFindItem(library, name) {
    for (var i = 0; i < library.items.length; i++) if (library.items[i].name === name) return library.items[i];
    return null;
}

function AnShelfFolders(library, folder) {
    var parts = folder.split("/"), built = "";
    for (var i = 0; i < parts.length; i++) {
        built += (built ? "/" : "") + parts[i];
        if (!library.itemExists(built) && library.newFolder(built) === false) throw new Error("无法创建元件库分类");
    }
}

function AnShelfNamespaceLibrary(library, prefix) {
    var names = [];
    for (var i = 0; i < library.items.length; i++) if (library.items[i].itemType !== "folder") names.push(library.items[i].name);
    for (var n = 0; n < names.length; n++) {
        var oldName = names[n], slash = oldName.lastIndexOf("/");
        var folder = prefix + (slash >= 0 ? "/" + oldName.substring(0, slash) : "");
        AnShelfFolders(library, folder);
        if (library.moveToFolder(folder, oldName, false) === false) throw new Error("元件命名空间整理失败：" + oldName);
    }
}

function AnShelfCollectScenes(doc, prefix) {
    var scenes = [], count = doc.timelines.length;
    if (!count || count > 1000) throw new Error("素材没有有效场景，或场景数量过多");
    AnShelfFolders(doc.library, prefix + "/scenes");
    for (var s = 0; s < count; s++) {
        doc.editScene(s);
        var original = doc.getTimeline(), frames = original.frameCount;
        if (!frames || !original.layers.length) throw new Error("场景没有可复制的时间轴：" + (s + 1));
        var sceneName = prefix + "/scenes/scene_" + (s + 1);
        original.copyLayers(0, original.layers.length - 1);
        if (doc.library.addNewItem("graphic", sceneName) === false || doc.library.editItem(sceneName) === false) throw new Error("无法创建完整场景元件");
        var sceneTimeline = doc.getTimeline(), emptyLayer = sceneTimeline.layers[0];
        sceneTimeline.pasteLayers(0);
        for (var j = sceneTimeline.layers.length - 1; j >= 0; j--) {
            if (sceneTimeline.layers[j] === emptyLayer && sceneTimeline.layers.length > 1) sceneTimeline.deleteLayer(j);
        }
        if (sceneTimeline.frameCount < frames) throw new Error("场景时间轴复制不完整");
        doc.exitEditMode();
        scenes.push({ name: original.name || "场景 " + (s + 1), symbol: sceneName, frames: frames });
    }
    return scenes;
}

function AnShelfBuildRoot(doc, prefix, scenes) {
    var rootName = prefix + "/whole", total = 0;
    for (var s = 0; s < scenes.length; s++) total += scenes[s].frames;
    if (total > 1000000) throw new Error("素材时间轴过长");
    if (doc.library.addNewItem("movie clip", rootName) === false || doc.library.editItem(rootName) === false) throw new Error("无法创建素材总元件");
    var timeline = doc.getTimeline(), offset = 0;
    if (total > 1) timeline.insertFrames(total - 1, true, 0);
    for (var i = 0; i < scenes.length; i++) {
        if (i > 0) timeline.addNewLayer(scenes[i].name, "normal", true);
        else timeline.layers[timeline.currentLayer].name = scenes[i].name;
        if (offset > 0) timeline.insertBlankKeyframe(offset);
        timeline.currentFrame = offset;
        doc.selectNone();
        var item = AnShelfFindItem(doc.library, scenes[i].symbol);
        if (doc.addItem({ x: 0, y: 0 }, item) === false || !doc.selection.length) throw new Error("场景元件放置失败");
        doc.selection[0].matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
        doc.selection[0].firstFrame = 0;
        doc.selection[0].loop = "play once";
        timeline.layers[timeline.currentLayer].frames[offset].name = scenes[i].name;
        offset += scenes[i].frames;
        if (offset < total) timeline.insertBlankKeyframe(offset);
    }
    doc.exitEditMode();
    return AnShelfFindItem(doc.library, rootName);
}

function AnShelfValidateRequest(request, trustedRootURI) {
    if (!request || request.version !== 1 || !request.asset || !/^[A-Za-z0-9-]{1,80}$/.test(request.requestId || "")) throw new Error("无效的插入请求");
    if (request.delivery !== undefined) {
        if (request.delivery !== "stage-drop" || typeof request.targetDocumentId !== "number" || !isFinite(request.targetDocumentId) || request.targetDocumentId < 0 || request.targetDocumentId > 9007199254740991 || Math.floor(request.targetDocumentId) !== request.targetDocumentId
            || typeof request.createdAt !== "number" || !isFinite(request.createdAt) || request.createdAt < 0 || Math.floor(request.createdAt) !== request.createdAt
            || typeof request.expiresAt !== "number" || !isFinite(request.expiresAt) || request.expiresAt > 9007199254740991 || request.expiresAt !== request.createdAt + 5000) throw new Error("舞台拖拽目标文档或请求时效无效");
        var now = new Date().getTime();
        if (request.createdAt > now + 1000 || request.expiresAt <= now) throw new Error("舞台拖拽请求已过期，请重新拖入");
    } else if (request.expiresAt !== undefined || request.targetDocumentId !== undefined) throw new Error("舞台拖拽请求缺少传递方式");
    if (!/^[a-f0-9]{64}$/.test(request.asset.hash || "")) throw new Error("无效的素材哈希");
    if (AnShelfURI(request.managedRoot) !== AnShelfURI(trustedRootURI)) throw new Error("素材库根目录不匹配");
    AnShelfRequireInside(request.asset.sourceURI, trustedRootURI, "assets/");
    AnShelfRequireInside(request.temporaryURI, trustedRootURI, "bridge/temp/");
    if (!/\.fla$/i.test(request.temporaryURI) || !/\.fla$/i.test(request.asset.sourceURI)) throw new Error("只能插入 FLA");
    if (!FLfile.exists(request.temporaryURI)) throw new Error("素材临时副本不存在");
}

function AnShelfURI(value) {
    if (typeof value !== "string" || !/^file:\/\/\//i.test(value)) throw new Error("无效的本地文件 URI");
    var decoded = decodeURIComponent(value).replace(/\\/g, "/");
    if (/(^|\/)\.\.?($|\/)/.test(decoded) || decoded.indexOf("\x00") >= 0) throw new Error("路径不能包含目录跳转");
    return decoded.replace(/\/+$/, "").toLowerCase();
}

function AnShelfRequireInside(value, root, folder) {
    var expected = AnShelfURI(root) + "/" + folder;
    if (AnShelfURI(value).indexOf(expected.toLowerCase()) !== 0) throw new Error("文件不在受管理素材目录内");
}

/* ES3-safe JSON reader: no eval and no scripts supplied by the queue. */
function AnShelfParseJSON(text) {
    if (typeof text !== "string" || text.length > 65536) throw new Error("插入请求过大或不是 JSON");
    if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
    var position = 0;
    function whitespace() { while (/\s/.test(text.charAt(position)) && position < text.length) position++; }
    function stringValue() {
        var start = position++, out = "";
        while (position < text.length) {
            var c = text.charAt(position++);
            if (c === '"') return out;
            if (c === "\\") {
                c = text.charAt(position++);
                if (c === "u") { var hex = text.substr(position, 4); if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error("无效 JSON 字符"); out += String.fromCharCode(parseInt(hex, 16)); position += 4; }
                else { var escaped = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }; if (escaped[c] === undefined) throw new Error("无效 JSON 转义"); out += escaped[c]; }
            } else { if (c.charCodeAt(0) < 32) throw new Error("无效 JSON 字符"); out += c; }
        }
        throw new Error("无效 JSON 字符串：" + start);
    }
    function value(depth) {
        if (depth > 12) throw new Error("JSON 嵌套过深");
        whitespace(); var c = text.charAt(position);
        if (c === '"') return stringValue();
        if (c === "{" || c === "[") {
            var object = c === "{", out = object ? {} : [], end = object ? "}" : "]";
            position++; whitespace(); if (text.charAt(position) === end) { position++; return out; }
            while (position < text.length) {
                var key; if (object) { if (text.charAt(position) !== '"') throw new Error("无效 JSON 键"); key = stringValue(); if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("不允许的 JSON 键"); whitespace(); if (text.charAt(position++) !== ":") throw new Error("无效 JSON 对象"); }
                var item = value(depth + 1); if (object) out[key] = item; else out.push(item);
                whitespace(); c = text.charAt(position++); if (c === end) return out; if (c !== ",") throw new Error("无效 JSON 分隔符"); whitespace();
            }
            throw new Error("JSON 未结束");
        }
        var rest = text.substring(position), literal = /^(true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest);
        if (!literal) throw new Error("无效 JSON 值"); position += literal[0].length;
        return literal[0] === "true" ? true : literal[0] === "false" ? false : literal[0] === "null" ? null : Number(literal[0]);
    }
    var result = value(0); whitespace(); if (position !== text.length) throw new Error("JSON 尾部无效"); return result;
}

function AnShelfJSON(value) {
    function quoted(s) { return '"' + String(s).replace(/["\\\x00-\x1f]/g, function(c) { var n = c.charCodeAt(0).toString(16); return "\\u" + ("0000" + n).substr(-4); }) + '"'; }
    var fields = [];
    for (var key in value) if (value.hasOwnProperty(key)) {
        var v = value[key]; if (v !== undefined) fields.push(quoted(key) + ":" + (typeof v === "number" || typeof v === "boolean" ? String(v) : v === null ? "null" : quoted(v)));
    }
    return "{" + fields.join(",") + "}";
}
