/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
(function () {
    'use strict';
    var insert = document.getElementById('insert');
    var queue, path, localURI, extension, api = window.__adobe_cep__;
    var current = null, busy = false, dropping = false, connected = false, timer = null, lastCompleted = null, lastResult = null;
    var documentId = null, contextKnown = false, probing = false, unloaded = false;

    function setButton(text, state, description, disabled) {
        insert.textContent = text;
        insert.title = description;
        insert.setAttribute('aria-label', text + '。' + description);
        insert.setAttribute('data-state', state);
        insert.disabled = disabled;
    }

    function showResult() {
        setButton(lastResult.text, lastResult.state, lastResult.description, true);
    }

    function assetName(request) {
        return String(request.asset.name || '未命名素材');
    }

    try {
        if (!api || !api.evalScript || !api.getSystemPath) throw new Error('CEP 环境不可用');
        var nodeRequire = window.cep_node && window.cep_node.require ? window.cep_node.require : require;
        path = nodeRequire('path');
        extension = decodeURI(api.getSystemPath('extension').replace(/^file:\/\//, ''));
        if (extension.charAt(0) === '/' && /^[A-Za-z]:/.test(extension.substring(1))) extension = extension.substring(1);
        var receiver = nodeRequire(path.join(extension, 'queue.cjs'));
        localURI = receiver.localURI;
        var appData = nodeRequire('process').env.APPDATA;
        if (!appData) throw new Error('无法定位 Windows AppData');
        queue = new receiver.Queue(path.join(appData, 'AnShelf'));
    } catch (error) {
        setButton('连接失败', 'error', String(error.message || error) + '。请检查 Animate 的 CEP 面板安装配置。', true);
        return;
    }

    function heartbeat() {
        try {
            queue.heartbeat(busy, documentId);
            connected = true;
            if (busy && current) setButton('正在粘贴…', 'busy', '正在粘贴素材：' + assetName(current), true);
            return true;
        } catch (error) {
            connected = false;
            setButton('连接失败', 'error', '无法写入桥接状态：' + String(error.message || error), true);
            return false;
        }
    }

    function refreshContext() {
        if (unloaded || probing) return;
        // An insertion temporarily activates its source document. Preserve the
        // target identity and publish busy until that operation has completed.
        if (busy) { heartbeat(); return; }
        probing = true;
        var code = '(function(){try{var d=fl.getDocumentDOM();return d&&typeof d.id==="number"&&isFinite(d.id)&&d.id>=0&&Math.floor(d.id)===d.id?String(d.id):"null";}catch(e){return "null";}})();';
        try {
            api.evalScript(code, function (response) {
                probing = false;
                if (unloaded) return;
                if (busy) { heartbeat(); return; }
                var id = response === 'null' ? null : Number(response);
                documentId = typeof response === 'string' && /^(0|[1-9][0-9]*)$/.test(response) && id <= 9007199254740991 ? id : null;
                contextKnown = true;
                if (heartbeat()) poll();
            });
        } catch (error) {
            probing = false;
            connected = false;
            documentId = null;
            contextKnown = false;
            setButton('连接失败', 'error', '无法读取 AN 当前文档：' + String(error.message || error), true);
        }
    }

    function poll() {
        if (busy || !connected) return;
        try {
            var pending = queue.pending();
            if (!pending) {
                current = null;
                if (lastResult) showResult();
                else setButton('等待素材', 'waiting', '已连接。可从安安素材管理器拖素材到此按钮直接粘贴，或在管理器点击“粘贴到舞台”。', true);
                return;
            }
            if (pending.requestId === lastCompleted) {
                current = null;
                showResult();
                return;
            }
            current = pending;
            lastCompleted = null;
            lastResult = null;
            if (pending.delivery === 'stage-drop') {
                if (!contextKnown) {
                    setButton('等待 AN 文档…', 'waiting', '正在确认拖拽时所在的 AN 文档。', true);
                    return;
                }
                var now = new Date().getTime();
                var error = pending.expiresAt <= now || pending.createdAt > now + 1000 ? '舞台拖拽请求已过期，请重新拖入' : pending.targetDocumentId !== documentId ? '拖拽目标文档已切换或关闭，请回到原文档重新拖入' : null;
                if (error) {
                    busy = true;
                    finish(pending, null, { ok: false, error: error });
                } else insertWhole();
                return;
            }
            setButton('粘贴到舞台', 'ready', '素材：' + assetName(pending) + '。粘贴到当前图层、当前播放指针位置，并居中到舞台。', false);
        } catch (error) {
            current = null;
            setButton('请求无效', 'error', '素材请求无效：' + String(error.message || error), true);
        }
    }

    function finish(request, prepared, result) {
        if (!busy || !current || current.requestId !== request.requestId || lastCompleted === request.requestId) return;
        var description = '素材：' + assetName(request) + '。';
        try { queue.complete(request, result); } catch (error) { result = { ok: false, error: '结果写入失败：' + String(error.message || error) }; }
        description += result.ok ? '已粘贴到当前舞台。' : String(result.error || '粘贴未完成');
        if (result.warning) description += '\n' + result.warning;
        if (prepared) {
            try { queue.cleanup(prepared.temporaryPath); } catch (error) { description += '\n临时素材仍被 AN 占用，关闭素材临时文档后可清理。'; }
        }
        busy = false;
        current = null;
        lastCompleted = request.requestId;
        lastResult = { text: result.ok ? '已粘贴 ✓' : '粘贴失败', state: result.ok ? 'success' : 'error', description: description };
        showResult();
        heartbeat();
    }

    function insertWhole() {
        if (!current || busy || !connected) return;
        var request = current, prepared = null;
        busy = true;
        setButton('正在粘贴…', 'busy', '正在粘贴素材：' + assetName(request), true);
        if (!heartbeat()) { busy = false; return; }
        try {
            prepared = queue.prepare(request);
            var scriptURI = localURI(path.join(extension, 'insert-whole.jsfl'));
            var requestJSON = JSON.stringify(prepared);
            var code = '(function(){try{return fl.runScript(' + JSON.stringify(scriptURI) + ',"AnShelfInsertWhole",' + JSON.stringify(requestJSON) + ',' + JSON.stringify(prepared.managedRoot) + ');}catch(e){return "{\\"version\\":1,\\"ok\\":false,\\"error\\":\\"JSFL加载失败\\"}";}})();';
            api.evalScript(code, function (response) {
                var result;
                try {
                    result = JSON.parse(response);
                    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('无效的结果');
                } catch (error) { result = { ok: false, error: 'AN 返回了无效结果，请检查目标舞台' }; }
                finish(request, prepared, result);
            });
        } catch (error) { finish(request, prepared, { ok: false, error: String(error.message || error) }); }
    }

    function dropFailure(error) {
        dropping = false;
        setButton('拖入失败', 'error', String(error.message || error), true);
    }

    function dropTransfer(event) {
        event.preventDefault();
        event.stopPropagation();
        if (busy || dropping || !connected) return;
        var files = event.dataTransfer && event.dataTransfer.files;
        if (!files || files.length !== 1 || !/^[a-zA-Z0-9-]{1,80}\.anshelf-transfer$/.test(files[0].name) || files[0].size > 4096) {
            dropFailure(new Error('请从安安素材管理器拖素材到此处；直接拖 FLA 文件不会粘贴到舞台'));
            return;
        }
        var file = files[0], reader = new FileReader();
        dropping = true;
        reader.onerror = function () { dropFailure(new Error('无法读取拖拽素材，请重新从管理器拖出')); };
        reader.onload = function () {
            dropping = false;
            if (busy || !connected || unloaded) return;
            try {
                current = queue.acceptDrop(JSON.parse(reader.result), file.name);
                if (current.requestId === lastCompleted) throw new Error('此素材已处理，请重新从管理器拖出');
                lastCompleted = null;
                lastResult = null;
                insertWhole();
            } catch (error) { dropFailure(error); }
        };
        try { reader.readAsText(file, 'UTF-8'); } catch (error) { dropFailure(error); }
    }

    insert.addEventListener('click', insertWhole);
    if (document.body && document.body.addEventListener) {
        document.body.addEventListener('dragover', function (event) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = busy || dropping ? 'none' : 'copy';
        });
        document.body.addEventListener('drop', dropTransfer);
    }
    setButton('正在连接…', 'waiting', '正在连接 AN 当前文档。', true);
    heartbeat();
    poll();
    refreshContext();
    timer = setInterval(refreshContext, 1000);
    window.addEventListener('unload', function () { unloaded = true; if (timer) clearInterval(timer); });
}());
