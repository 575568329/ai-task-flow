// ==UserScript==
// @name         简→繁 正确/错误 替换器 + 题目导航
// @namespace    exam-editor-sc2tc
// @version      3.2
// @description  浮动面板：按顺序导航题目ID + 一键替换简体"正确/错误"为繁体"正確/錯誤"（支持 iframe）
// @author       Claude
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ========== 初始 ID 列表（来自 filtered_ids_new.txt） ==========

  const INITIAL_IDS = [
    "5deace4d-c0d4-4143-98ab-c9917593ad45","d61f8662-c345-4639-b3cd-79d0a2830d6c","42258bfa-3132-477a-b123-38e79a8b10ed","57537d00-5509-4954-a1d4-14fa325db151","367d331a-92e8-46c8-bb89-1216f9a3ddee","af2e1fef-1a34-43b6-ab3e-d6d2a088797f","01a71061-fb6b-4334-82b0-18135e12654a","3dbd71ac-d555-4a77-8d25-dedae651438f","9dd8e976-8567-4c74-8536-64efad0aeea1","9c7d0d0a-ed98-4f41-932a-a1f10ec78288","182b5459-1c8f-4e84-8967-9856ac04a3a9","c9503c00-8e71-4591-b08c-462a8b541189","6a9ab8a6-8550-4598-a907-585ef7deb8be","bb79da8e-0cb7-4432-8d5a-5308c8ab6e73","d0f342d8-8cc9-4a89-b216-7d92b3d616e5","b31b54da-72b1-4ae8-83b3-214c379c3ebd","5ebcf3dd-3f01-4e1a-a335-8fc15739c89d","b8fec606-b686-4675-94e6-32d6cd516666","e3bfdf8f-7494-4441-a7f0-2d3ff228d194","d62d3bc0-07d5-4b60-ae56-1ed891682695","ac6b48e9-6763-488e-861d-598eb5ab94e0","7d2b861f-7aac-4491-81e1-d564f559b5c9","62a1f089-f123-467d-b2b0-abd537d39feb","7eb74c73-05b5-4a35-a61f-91291d94a1a0","07cf8a6f-23e9-4ec2-b813-fb010d24c8a3","3d4b582a-b299-415a-8352-61dc50c9f34c","70dba1cf-5102-459a-bc52-14aa4ad577a8","b09bbe24-788d-4619-9d04-789be92759ce","228930c8-6db2-4acd-827d-fa27d43607e1","1e0beb74-22ff-4829-913d-704c6df67b18","534dac91-2080-4a81-ad1f-fb4e221ad761","d1158f00-1e55-430e-b143-20c33befdaf0","e77cc390-672e-4785-9f5f-dd096d49af6a","5635c6dd-6a16-4463-990c-b6ed917ffaf7","9b52d6d9-543f-4c2e-aaee-001066f8ffaf","1e5b2a20-b2ef-45c5-9225-7c29e827f231","6c0d917d-b83f-4151-85d8-ed6b277581ec","fb8e8abc-b815-4170-98c6-66bb2ec1fced","dae552f3-189f-4ca0-9176-12889adb7ed0","63bdebc3-fe0f-4fb2-9a26-f20babd83ee0","d30610be-a413-44fe-b795-6204a1440360","5cb74720-572e-429c-8fc5-49014a36f267","c18813c6-12f3-47e2-a853-568d568d098b","318c6f17-c28a-4b2c-b486-446045756c49","f59eb732-1446-47c4-8997-a50ff283ea27","9d03946f-83f1-49dd-b58f-0d23684cb95c","12e4ccfd-5c9c-497b-a250-07bf84269283","11774f01-cf97-48b1-b28c-4fef86c9b9da","a374a619-8415-4d9b-a10c-04e782304fe2","17a8a194-d48d-452c-9b21-b70fabb07203","a89044fe-ac97-421c-a2b9-7158d6b4e85d","83915701-5f6e-493d-99d4-87c40d48256f","9b387938-3314-4f54-9754-9ca905f0f62e","d49a8282-9891-4203-a052-dbd97f929bf4","8bc9e103-f87e-4abd-9f1b-71e37e3021ac","41ac6d01-8a2d-43a1-a1b2-acdb8b8040da","ebe619e0-1d87-4eb9-b419-318c3a04ca5f","8c783151-7351-447a-b5d1-c3f946af4b61","dbbd0d6e-44df-4e2b-9beb-a4273fe90c3c","82e343aa-11eb-4371-8275-45e20eeeb2bf","11f93d60-cb99-4a9c-b9e5-60bc36121ca5","7b242f61-ef92-4ccf-8045-d5fd823825b0","31bc3045-bd11-4c1b-8812-489d9f34e5fe","c2e19635-e7ad-4293-89d0-6c0f15150ec8","81167451-ac1f-4dc4-8530-0df201ce876e","92cde0d2-ce05-40b2-b631-04d7003e6a8d","cd59e986-3976-49ca-9215-857a1d2e1f9f","186c3675-5c9d-4c88-90cb-dd8a878fa86c","01d0e661-ece8-4619-bc55-64dfb84e01d7","66949012-6385-43d1-a4a8-ee4c6596fbc4","48c4f811-0b3a-431c-b6c3-0b73070649fe","1db8fabc-0e6b-4e38-8543-65686ecd13d1","a63c0662-95cf-4514-892b-50d0bf19c6dc","4a8a8f63-3e79-4322-9291-4362dba0060c","0cb46379-8320-454e-ac9b-111e148509e5","f313ae94-9d65-4714-9547-2eba47cab74c","9aa6e4ea-0ec3-4607-acb4-4515b5630fa3","6e71d16a-1522-4d17-8d13-298b5b72886f","7c0a7e20-3190-4f8c-b045-3fd45c14d814","91be73f5-e852-4a9d-813a-9a241dbc0ec4","e97f5ae8-8cfc-4bc2-ae83-41296d0fa22f","57e4ae7c-3f48-4a8b-b861-a0c7d3123ac4","965df967-4240-428a-b059-3d00b97cdf70","624bdff5-4bb8-45f5-b663-ca88bbeee1e3","64b228d9-9327-43e6-b064-4b1bcc1f4a6d","7b3f99da-0a93-40aa-981e-037c3b93d8d6","1016e942-7457-40ee-b755-090d76eff62d","49145d44-882d-459c-80c1-8550331f60f7","c65bfda1-21e7-481e-8d31-dd980daee3d9","55468c78-ee26-4b84-a6df-48ec23508b9c","c1be3fbf-66b7-48ab-bd66-924ca7952026","cbcf41e0-a8d0-4829-acac-fa88f2157e58","fbb1f54a-afb4-4698-a62c-cccdc299191e","d6d7d669-1362-415b-8b93-fb15f89dc6d9","8fb8f9df-0cfb-456d-9f7d-c8f76793b54b","d06bae02-08e6-4ec7-a72a-ecac3622049e","764334eb-8732-4657-bda9-e2734c883a28","7c8ed560-cbe7-4464-9545-6f1e6d2b3d13","296e7056-9564-40a0-84fb-9cd690b5d1e8","0db7698e-bf66-453b-b28b-4e662b271cc4","0062024c-ece6-4606-ab95-c5f69427093e","c43295ba-82d5-4535-ab79-bd974ca43523","34b0ee19-073d-4c25-8d0c-b3b80a00499e","308d9a05-0ee7-40a2-86ff-e6b5d379acf7","3833025d-f3ca-4754-8c41-dce23f035409","aaa315a1-5309-43b1-9d89-0529bff2b772","09ae75f5-cd37-424a-b65d-edc6f4f4266a","0c34d7f1-0021-4cbb-9f35-2cf62a5ecd1a","dbb19d65-5fb1-447a-801c-57d67457da3c","7f0c1d12-ff18-4839-85bc-90c6e5f174e4","2274b64e-43b1-4240-b0d6-e562bfd00a31","305c659d-10b3-4d77-ac1c-b700781be187","92ab197e-92e3-46ed-8c1f-2d2eca13f625","f9520920-cbf7-4716-84c5-ec87f7350fd4","d65a6597-0cca-4451-a9e3-6e81b42b5398","90d52a0b-b69f-4daa-92c2-fd1cf03b3a23","b31fadc2-c407-4821-8d17-95564b11e294","8e424876-d364-4da8-be86-4ce68f42c407","8d04dc85-a658-4daf-a410-5db56022e0ab","b17b34b7-dad3-4afe-b691-98a4d3a27f1c","03d6d271-a199-42ec-90c4-f90eee745460","9278a0ab-4ed3-47fe-8033-5db991d10974","d85ee7ba-2692-4387-9191-23d517203e6d"
  ];

  // ========== 状态 ==========

  let idList = [...INITIAL_IDS];
  let currentIndex = 0;
  let editLinkWatcher = null;  // 轮询定时器

  // ========== DOM 引用（延迟获取，穿透 iframe） ==========

  /**
   * 获取目标文档。iframe 是 same-origin 时可访问其 contentDocument。
   * 优先匹配 #contentFrame，兜底遍历所有 iframe，最终回退到顶层 document。
   */
  function getTargetDoc() {
    // 1) 优先：指定的 contentFrame
    const contentFrame = document.getElementById('contentFrame');
    if (contentFrame) {
      try {
        const doc = contentFrame.contentDocument || contentFrame.contentWindow?.document;
        if (doc && doc.body) return doc;
      } catch (_) { /* cross-origin */ }
    }

    // 2) 兜底：遍历所有 iframe
    const allFrames = document.querySelectorAll('iframe');
    for (const f of allFrames) {
      try {
        const doc = f.contentDocument || f.contentWindow?.document;
        if (doc && doc.getElementById('shijuanid')) return doc;
      } catch (_) { /* cross-origin */ }
    }

    // 3) 最终回退
    return document;
  }

  function getShijuanidInput() {
    const doc = getTargetDoc();
    return doc.getElementById('shijuanid');
  }

  // ========== 解析 ID 列表 ==========

  function parseIdList() {
    const raw = document.getElementById('sc2tc-id-textarea').value.trim();
    idList = raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // clamp index
    if (currentIndex >= idList.length) {
      currentIndex = Math.max(0, idList.length - 1);
    }
  }

  // ========== Toast ==========

  function showToast(message, type) {
    document.querySelectorAll('.sc2tc-toast').forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = 'sc2tc-toast';
    toast.textContent = message;

    const colors = { success: '#10b981', warn: '#f59e0b', error: '#ef4444', info: '#6366f1' };

    Object.assign(toast.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '12px 28px', borderRadius: '8px',
      fontSize: '15px', fontWeight: '600', color: '#fff',
      backgroundColor: colors[type] || colors.info,
      boxShadow: '0 4px 24px rgba(0,0,0,0.25)', pointerEvents: 'none',
      animation: 'sc2tc-slide-in 0.35s ease-out',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif',
    });

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-10px)';
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  // ========== 替换逻辑（穿透 iframe） ==========

  function doReplace() {
    const REPLACE_MAP = { '正确': '正確', '错误': '錯誤' };
    const doc = getTargetDoc();
    const divs = doc.querySelectorAll('div.textarea.common-div[contenteditable="true"]');
    let count = 0;

    divs.forEach((div) => {
      const text = (div.textContent || '').trim();
      if (REPLACE_MAP[text]) {
        div.textContent = REPLACE_MAP[text];
        count++;
      }
    });

    return { total: divs.length, replaced: count };
  }

  // ========== 导航逻辑 ==========

  function navigateToIndex(index) {
    if (idList.length === 0) {
      showToast('❌ ID 列表为空，请先填入题目 ID', 'error');
      return;
    }

    if (index < 0 || index >= idList.length) {
      showToast('⚠️ 已到达边界', 'warn');
      return;
    }

    currentIndex = index;
    const id = idList[currentIndex];
    const input = getShijuanidInput();

    if (!input) {
      showToast('❌ 页面未找到 id="shijuanid" 输入框', 'error');
      return;
    }

    // 写入 shijuanid 并触发事件
    input.value = id;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // 自动点击"查询"按钮
    const doc = getTargetDoc();
    const queryBtn = doc.querySelector('input[type="button"][value="查 询"]')
                  || doc.querySelector('input.btn-success[onclick*="query"]');
    if (queryBtn) {
      queryBtn.click();
    }

    // 等待查询结果加载后自动点击"编辑"
    waitForEditLinkAndClick();

    updatePanel();
    showToast(`📌 已跳转到第 ${currentIndex + 1} 题 (${idList.length} 题中)`, 'info');
  }

  function goNext()     { navigateToIndex(currentIndex + 1); }
  function goPrev()     { navigateToIndex(currentIndex - 1); }
  function goFirst()    { navigateToIndex(0); }
  function goLast()     { navigateToIndex(idList.length - 1); }

  // ========== 自动点击"编辑"链接 ==========

  function waitForEditLinkAndClick() {
    // 清除上一次轮询
    if (editLinkWatcher) clearInterval(editLinkWatcher);

    let attempts = 0;
    const maxAttempts = 40; // 20 秒超时

    editLinkWatcher = setInterval(() => {
      attempts++;
      const doc = getTargetDoc();

      // 查找"编辑"链接：href 含 toEdit 且文本为"编辑"
      const editLinks = doc.querySelectorAll('a[href*="toEdit"]');
      for (const link of editLinks) {
        if (link.textContent.trim() === '编辑') {
          clearInterval(editLinkWatcher);
          editLinkWatcher = null;
          link.click();
          showToast('📝 已进入编辑页面', 'success');
          return;
        }
      }

      if (attempts >= maxAttempts) {
        clearInterval(editLinkWatcher);
        editLinkWatcher = null;
        showToast('⚠️ 超时：未找到编辑按钮，请手动点击', 'warn');
      }
    }, 500);
  }

  // ========== 更新面板显示 ==========

  function updatePanel() {
    const posEl = document.getElementById('sc2tc-position');
    const curEl = document.getElementById('sc2tc-current-id');
    if (posEl) {
      posEl.textContent =
        idList.length > 0 ? `${currentIndex + 1} / ${idList.length}` : '0 / 0';
    }
    if (curEl) {
      curEl.textContent = idList.length > 0
        ? `当前: ${idList[currentIndex].substring(0, 8)}...`
        : '当前: 无';
      curEl.title = idList.length > 0 ? idList[currentIndex] : '';
    }
  }

  // ========== 构建面板 UI ==========

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'sc2tc-panel';

    const minimized = localStorage.getItem('sc2tc-minimized') === '1';

    panel.innerHTML = `
      <div class="sc2tc-header">
        <span class="sc2tc-title">📋 题目导航</span>
        <div class="sc2tc-header-btns">
          <button class="sc2tc-btn-icon" id="sc2tc-btn-minimize" title="折叠/展开">${minimized ? '▸' : '▾'}</button>
        </div>
      </div>
      <div class="sc2tc-body" id="sc2tc-body" style="${minimized ? 'display:none' : ''}">
        <!-- 导航区 -->
        <div class="sc2tc-nav-row">
          <button class="sc2tc-btn sc2tc-btn-nav" id="sc2tc-btn-first" title="第一题">⏮</button>
          <button class="sc2tc-btn sc2tc-btn-nav" id="sc2tc-btn-prev" title="上一题">◀</button>
          <span class="sc2tc-position" id="sc2tc-position">${idList.length > 0 ? `1 / ${idList.length}` : '0 / 0'}</span>
          <button class="sc2tc-btn sc2tc-btn-nav" id="sc2tc-btn-next" title="下一题">▶</button>
          <button class="sc2tc-btn sc2tc-btn-nav" id="sc2tc-btn-last" title="最后一题">⏭</button>
        </div>

        <!-- 当前 ID -->
        <div class="sc2tc-current-id" id="sc2tc-current-id" title="${idList.length > 0 ? idList[0] : ''}">
          ${idList.length > 0 ? `当前: ${idList[0].substring(0, 8)}...` : '当前: 无'}
        </div>

        <!-- 操作按钮行 -->
        <div class="sc2tc-actions">
          <button class="sc2tc-btn sc2tc-btn-replace" id="sc2tc-btn-replace">简 → 繁</button>
          <button class="sc2tc-btn sc2tc-btn-goto" id="sc2tc-btn-goto">跳转到此题</button>
        </div>

        <!-- 提交按钮 -->
        <div class="sc2tc-actions" style="margin-top:2px">
          <button class="sc2tc-btn sc2tc-btn-submit" id="sc2tc-btn-submit">✅ 提交</button>
        </div>

        <!-- ID 列表折叠区 -->
        <div class="sc2tc-list-toggle" id="sc2tc-list-toggle">📝 编辑 ID 列表 (点击展开)</div>
        <div class="sc2tc-list-area" id="sc2tc-list-area" style="display:none">
          <textarea id="sc2tc-id-textarea" spellcheck="false"></textarea>
          <div class="sc2tc-list-actions">
            <button class="sc2tc-btn sc2tc-btn-sm" id="sc2tc-btn-apply">✅ 应用修改</button>
            <button class="sc2tc-btn sc2tc-btn-sm sc2tc-btn-reset" id="sc2tc-btn-reset">🔄 恢复默认</button>
          </div>
        </div>
      </div>
    `;

    // ID 列表 textarea 填充
    setTimeout(() => {
      const ta = document.getElementById('sc2tc-id-textarea');
      if (ta) ta.value = idList.join('\n');
    }, 0);

    return panel;
  }

  // ========== 绑定事件 ==========

  function bindEvents() {
    // 折叠/展开
    document.getElementById('sc2tc-btn-minimize').addEventListener('click', () => {
      const body = document.getElementById('sc2tc-body');
      const btn = document.getElementById('sc2tc-btn-minimize');
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? '' : 'none';
      btn.textContent = isHidden ? '▾' : '▸';
      localStorage.setItem('sc2tc-minimized', isHidden ? '0' : '1');
    });

    // 导航
    document.getElementById('sc2tc-btn-first').addEventListener('click', goFirst);
    document.getElementById('sc2tc-btn-prev').addEventListener('click', goPrev);
    document.getElementById('sc2tc-btn-next').addEventListener('click', goNext);
    document.getElementById('sc2tc-btn-last').addEventListener('click', goLast);

    // 简→繁 替换
    document.getElementById('sc2tc-btn-replace').addEventListener('click', () => {
      const { total, replaced } = doReplace();
      if (replaced > 0) {
        showToast(`✅ 成功替换 ${replaced} 处`, 'success');
      } else if (total > 0) {
        showToast('⚠️ 已扫描，未找到需要替换的简体内容', 'warn');
      } else {
        showToast('❌ 当前页面未找到可编辑的选项区', 'error');
      }
    });

    // 跳转到当前题
    document.getElementById('sc2tc-btn-goto').addEventListener('click', () => {
      parseIdList();
      navigateToIndex(currentIndex);
    });

    // 提交按钮
    document.getElementById('sc2tc-btn-submit').addEventListener('click', () => {
      const doc = getTargetDoc();
      const saveBtn = doc.getElementById('tjshow')
                   || doc.querySelector('input[type="button"][value="提交"]')
                   || doc.querySelector('input[onclick*="save"]');
      if (saveBtn) {
        saveBtn.click();
        showToast('✅ 已点击提交', 'success');
      } else {
        showToast('❌ 未找到提交按钮 (#tjshow)', 'error');
      }
    });

    // 编辑列表折叠
    document.getElementById('sc2tc-list-toggle').addEventListener('click', () => {
      const area = document.getElementById('sc2tc-list-area');
      const toggle = document.getElementById('sc2tc-list-toggle');
      const isHidden = area.style.display === 'none';
      area.style.display = isHidden ? '' : 'none';
      toggle.textContent = isHidden ? '📝 编辑 ID 列表 (点击收起)' : '📝 编辑 ID 列表 (点击展开)';
    });

    // 应用修改
    document.getElementById('sc2tc-btn-apply').addEventListener('click', () => {
      parseIdList();
      updatePanel();
      showToast(`✅ 已更新，共 ${idList.length} 个 ID`, 'success');
    });

    // 恢复默认
    document.getElementById('sc2tc-btn-reset').addEventListener('click', () => {
      idList = [...INITIAL_IDS];
      currentIndex = 0;
      const ta = document.getElementById('sc2tc-id-textarea');
      if (ta) ta.value = idList.join('\n');
      updatePanel();
      showToast('🔄 已恢复默认 ID 列表', 'info');
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      // 不在 input/textarea 内时响应
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'Enter')      { e.preventDefault(); doReplace(); }
    });
  }

  // ========== 注入样式 ==========

  GM_addStyle(`
    @keyframes sc2tc-slide-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-18px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    #sc2tc-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483645;
      width: 280px;
      background: #1e1e2e;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      color: #cdd6f4;
      font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
      font-size: 13px;
      overflow: hidden;
      user-select: none;
    }

    .sc2tc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #181825;
      border-bottom: 1px solid #313244;
      cursor: default;
    }

    .sc2tc-title {
      font-weight: 700;
      font-size: 14px;
      color: #cdd6f4;
    }

    .sc2tc-header-btns {
      display: flex;
      gap: 4px;
    }

    .sc2tc-btn-icon {
      background: none;
      border: none;
      color: #a6adc8;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .sc2tc-btn-icon:hover { background: #313244; color: #cdd6f4; }

    .sc2tc-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sc2tc-nav-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .sc2tc-btn-nav {
      background: #313244;
      border: none;
      color: #cdd6f4;
      cursor: pointer;
      font-size: 14px;
      padding: 6px 10px;
      border-radius: 6px;
      transition: background 0.15s;
    }
    .sc2tc-btn-nav:hover { background: #45475a; }

    .sc2tc-position {
      font-weight: 700;
      font-size: 15px;
      color: #89b4fa;
      min-width: 70px;
      text-align: center;
    }

    .sc2tc-current-id {
      text-align: center;
      font-size: 11px;
      color: #a6adc8;
      background: #181825;
      padding: 6px 10px;
      border-radius: 6px;
      font-family: "Cascadia Code", "Fira Code", monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sc2tc-actions {
      display: flex;
      gap: 8px;
    }

    .sc2tc-btn {
      border: none;
      cursor: pointer;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      transition: background 0.15s, transform 0.1s;
      outline: none;
    }
    .sc2tc-btn:active { transform: scale(0.96); }

    .sc2tc-btn-replace {
      flex: 1;
      background: #a6e3a1;
      color: #1e1e2e;
      padding: 8px 12px;
    }
    .sc2tc-btn-replace:hover { background: #94e2d5; }

    .sc2tc-btn-goto {
      flex: 1;
      background: #89b4fa;
      color: #1e1e2e;
      padding: 8px 12px;
    }
    .sc2tc-btn-goto:hover { background: #74c7ec; }

    .sc2tc-btn-submit {
      width: 100%;
      background: #f9e2af;
      color: #1e1e2e;
      padding: 8px 12px;
    }
    .sc2tc-btn-submit:hover { background: #f5c2e7; }

    .sc2tc-list-toggle {
      font-size: 12px;
      color: #a6adc8;
      cursor: pointer;
      padding: 4px 0;
      border-top: 1px solid #313244;
    }
    .sc2tc-list-toggle:hover { color: #cdd6f4; }

    .sc2tc-list-area {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    #sc2tc-id-textarea {
      width: 100%;
      height: 160px;
      background: #181825;
      color: #cdd6f4;
      border: 1px solid #313244;
      border-radius: 6px;
      padding: 8px;
      font-family: "Cascadia Code", "Fira Code", monospace;
      font-size: 11px;
      resize: vertical;
      box-sizing: border-box;
      outline: none;
    }
    #sc2tc-id-textarea:focus { border-color: #89b4fa; }

    .sc2tc-list-actions {
      display: flex;
      gap: 6px;
    }

    .sc2tc-btn-sm {
      flex: 1;
      padding: 6px 10px;
      font-size: 12px;
      background: #45475a;
      color: #cdd6f4;
    }
    .sc2tc-btn-sm:hover { background: #585b70; }

    .sc2tc-btn-reset {
      background: #313244;
    }
    .sc2tc-btn-reset:hover { background: #45475a; }
  `);

  // ========== 启动 ==========

  function init() {
    const panel = buildPanel();
    document.body.appendChild(panel);
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
