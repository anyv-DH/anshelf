/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
(function () {
    'use strict';
    var insert = document.getElementById('insert');
    var addCurrent = document.getElementById('add-current');
    var addDialog = document.getElementById('add-confirm'), confirmSave = document.getElementById('confirm-save'), confirmCancel = document.getElementById('confirm-cancel');
    var queue, path, localURI, extension, api = window.__adobe_cep__;
    var current = null, busy = false, dropping = false, connected = false, timer = null, lastCompleted = null, lastResult = null;
    var documentId = null, contextKnown = false, probing = false, unloaded = false;
    var adding = false, addRequest = null, addStarted = 0, addGeneration = 0;
    var confirmation = null, confirmTimer = null;

    function closeConfirmation() {
        if (confirmTimer) window.clearTimeout(confirmTimer);
        confirmTimer = null;
        if (addDialog) addDialog.hidden = true;
        var previous = confirmation;
        confirmation = null;
        if (previous && previous.resized) {
            try { api.resizeContent(previous.width, previous.height); } catch (error) { /* AN owns docking geometry. */ }
        }
    }

    function confirmCurrentDocument(generation) {
        if (!addDialog || !confirmSave || !confirmCancel || documentId === null) return false;
        var width = Number(window.innerWidth), height = Number(window.innerHeight);
        if (!(width > 0 && height > 0)) return false;
        if ((width < 280 || height < 200) && typeof api.resizeContent !== 'function') return false;
        confirmation = { generation: generation, documentId: documentId, width: width, height: height, resized: false };
        function show() {
            if (unloaded || !adding || generation !== addGeneration || !confirmation) return;
            if (window.innerWidth < 280 || window.innerHeight < 200) {
                // Some docked AN panels cannot resize. Keep their native
                // confirmation, never an unreadable dialog in a 48px column.
                closeConfirmation();
                saveCurrentDocument(generation, null);
                return;
            }
            addDialog.hidden = false;
            confirmCancel.focus();
        }
        if (width < 280 || height < 200) {
            confirmation.resized = true;
            try { api.resizeContent(340, 230); }
            catch (error) { closeConfirmation(); return false; }
            confirmTimer = window.setTimeout(show, 120);
        } else show();
        return true;
    }

    function setAddButton(text, state, description, disabled) {
        if (!addCurrent) return;
        addCurrent.textContent = text;
        addCurrent.title = description;
        addCurrent.setAttribute('aria-label', text + '。' + description);
        addCurrent.setAttribute('data-state', state);
        addCurrent.disabled = disabled;
    }

    function finishAdd(result) {
        closeConfirmation();
        if (addRequest) {
            try { queue.clearDocumentImport(addRequest.requestId); } catch (error) { /* Result cleanup does not undo the import. */ }
        }
        addRequest = null;
        adding = false;
        addGeneration++;
        var description = result.cancelled ? '已取消加入，未添加或更新素材。' : result.ok ? '素材：' + (result.name || '当前文档') + '。已加入安安素材管理器；预览在后台生成，可回管理器分类。' : String(result.error || '加入未完成');
        setAddButton(result.cancelled ? '已取消' : result.ok ? '已加入 ✓' : '加入失败', result.cancelled ? 'ready' : result.ok ? 'success' : 'error', description, false);
        if (!unloaded) { heartbeat(); poll(); }
    }

    function addCurrentDocument() {
        if (!addCurrent || adding || busy || !connected || unloaded) return;
        adding = true;
        addStarted = new Date().getTime();
        var generation = ++addGeneration;
        setAddButton('等待确认…', 'busy', '请在 AN 中确认是否保存并加入素材库；取消不会保存或加入。', true);
        insert.disabled = true;
        heartbeat();
        if (!confirmCurrentDocument(generation)) saveCurrentDocument(generation, null);
    }

    function saveCurrentDocument(generation, confirmedDocumentId) {
        if (unloaded || !adding || generation !== addGeneration) return;
        setAddButton(confirmedDocumentId === null ? '等待确认…' : '正在保存…', 'busy', '保存当前 AN 文档；取消保存就取消加入。', true);
        try {
            var scriptURI = localURI(path.join(extension, 'insert-whole.jsfl'));
            var confirmed = confirmedDocumentId === null ? '' : ',' + JSON.stringify(String(confirmedDocumentId));
            var code = '(function(){try{return fl.runScript(' + JSON.stringify(scriptURI) + ',"AnShelfCurrentDocumentForLibrary"' + confirmed + ');}catch(e){return "{\\"version\\":1,\\"ok\\":false,\\"error\\":\\"无法读取当前AN文档\\"}";}})();';
            api.evalScript(code, function (response) {
                if (unloaded || !adding || generation !== addGeneration) return;
                try {
                    var result = JSON.parse(response);
                    if (!result || result.version !== 1 || typeof result.ok !== 'boolean') throw new Error('AN 返回的当前文档信息无效');
                    if (!result.ok) { finishAdd(result); return; }
                    addRequest = queue.requestDocumentImport(result.file);
                    // The timeout begins after the user finishes Animate's native Save dialog.
                    addStarted = new Date().getTime();
                    setAddButton('正在加入…', 'busy', '请保持安安素材管理器开启；正在加入：' + (result.name || '当前文档'), true);
                } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
            });
        } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
    }

    function checkDocumentImport() {
        if (!adding || !addRequest) return;
        try {
            var result = queue.documentImportResult(addRequest.requestId);
            if (result) { finishAdd(result); return; }
            if (new Date().getTime() - addStarted > 60000) finishAdd({ ok: false, error: '素材管理器未及时响应，请先打开最新版管理器再重试；正在处理的素材可能稍后完成。' });
        } catch (error) { finishAdd({ ok: false, error: String(error.message || error) }); }
    }

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
        setAddButton('连接失败', 'error', String(error.message || error), true);
        return;
    }

    function heartbeat() {
        try {
            queue.heartbeat(busy || adding, documentId);
            connected = true;
            if (addCurrent) addCurrent.disabled = busy || adding;
            if (busy && current) setButton('正在粘贴…', 'busy', '正在粘贴素材：' + assetName(current), true);
            return true;
        } catch (error) {
            connected = false;
            if (addCurrent) addCurrent.disabled = true;
            setButton('连接失败', 'error', '无法写入桥接状态：' + String(error.message || error), true);
            return false;
        }
    }

    function refreshContext() {
        if (unloaded || probing) return;
        if (adding) { checkDocumentImport(); if (adding) { heartbeat(); return; } }
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
        if (busy || adding || !connected) return;
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
                    finish(pending, { ok: false, error: error });
                } else insertWhole();
                return;
            }
            setButton('粘贴到舞台', 'ready', '素材：' + assetName(pending) + '。粘贴到当前图层、当前播放指针位置，并居中到舞台。', false);
        } catch (error) {
            current = null;
            setButton('请求无效', 'error', '素材请求无效：' + String(error.message || error), true);
        }
    }

    function finish(request, result) {
        if (!busy || !current || current.requestId !== request.requestId || lastCompleted === request.requestId) return;
        var description = '素材：' + assetName(request) + '。';
        try { queue.complete(request, result); } catch (error) { result = { ok: false, error: '结果写入失败：' + String(error.message || error) }; }
        description += result.ok ? '已粘贴到当前舞台。' : String(result.error || '粘贴未完成');
        if (result.warning) description += '\n' + result.warning;
        busy = false;
        current = null;
        lastCompleted = request.requestId;
        lastResult = { text: result.ok ? '已粘贴 ✓' : '粘贴失败', state: result.ok ? 'success' : 'error', description: description };
        showResult();
        heartbeat();
    }

    function insertWhole() {
        if (!current || busy || adding || !connected) return;
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
                finish(request, result);
            });
        } catch (error) { finish(request, { ok: false, error: String(error.message || error) }); }
    }

    function dropFailure(error) {
        dropping = false;
        setButton('拖入失败', 'error', String(error.message || error), true);
    }

    function dropTransfer(event) {
        event.preventDefault();
        event.stopPropagation();
        if (busy || adding || dropping || !connected) return;
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
            if (busy || adding || !connected || unloaded) return;
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
    if (addCurrent) addCurrent.addEventListener('click', addCurrentDocument);
    if (confirmCancel) confirmCancel.addEventListener('click', function () {
        if (confirmation) finishAdd({ ok: false, cancelled: true });
    });
    if (confirmSave) confirmSave.addEventListener('click', function () {
        if (!confirmation || unloaded || !adding || busy) return;
        var accepted = confirmation;
        closeConfirmation();
        saveCurrentDocument(accepted.generation, accepted.documentId);
    });
    if (document.addEventListener) document.addEventListener('keydown', function (event) {
        if (!confirmation || !addDialog || addDialog.hidden) return;
        if (event.key === 'Escape' || event.keyCode === 27) { event.preventDefault(); finishAdd({ ok: false, cancelled: true }); }
        else if (event.key === 'Tab' || event.keyCode === 9) {
            event.preventDefault();
            if (document.activeElement === confirmCancel) confirmSave.focus(); else confirmCancel.focus();
        }
    });
    if (document.body && document.body.addEventListener) {
        document.body.addEventListener('dragover', function (event) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = busy || adding || dropping ? 'none' : 'copy';
        });
        document.body.addEventListener('drop', dropTransfer);
    }
    setButton('正在连接…', 'waiting', '正在连接 AN 当前文档。', true);
    heartbeat();
    poll();
    refreshContext();
    timer = setInterval(refreshContext, 1000);
    window.addEventListener('unload', function () { unloaded = true; if (timer) clearInterval(timer); if (confirmTimer) window.clearTimeout(confirmTimer); });
}());
