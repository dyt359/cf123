/* cf123 控制台 —— 订阅获取 + 配置管理
   后端接口（均带 CORS，可跨域调用）：
     GET  /                          健康检查 -> { status, message }
     GET  /<UUID>/sub                订阅内容
     GET  /<UUID>/region             节点地区
     GET  /<UUID>/test-api           连通性测试
     GET  /<UUID>/api/config         读取配置 -> 配置快照
     POST /<UUID>/api/config         保存配置（body 为键值对，空串表示删除该项）
     GET  /<UUID>/api/preferred-ips  读取优选 IP 列表
     POST /<UUID>/api/preferred-ips  追加优选 IP（body: {ip, port, name} 或数组）

   注意：所有配置读写都走 /api/ 接口，不会触发 Worker 的 HTML 渲染；
   Worker 端的缓存拦截也显式排除了 /api/ 路径。 */

(function () {
  'use strict';

  var 默认后端 = 'https://cf123-1ju.pages.dev';
  var 存储键 = {
    backend: 'cf123.backend',
    uuid: 'cf123.uuid',
    testInput: 'cf123.testInput',
    testPort: 'cf123.testPort'
  };

  // 配置表单字段的默认值（与后端 _worker.js 的「配置默认值」保持一致）
  var 默认配置 = {
    ev: 'yes', et: 'no', ex: 'no',
    d: '', p: '', yx: '', yxURL: '', s: '',
    ech: 'no', customDNS: 'https://223.5.5.5/dns-query', customECHDomain: 'cloudflare-ech.com',
    yxby: '', rm: '', qj: '', dkby: 'no'
  };

  var el = {};
  var 测试控制器 = null;   // 延迟测试的中止控制器
  var 测试结果 = [];       // {地址, 延迟(ms), 成功}

  /* ==================== 工具 ==================== */

  function $(id) { return document.getElementById(id); }

  function 读存储(键, 兜底) {
    try {
      var v = localStorage.getItem(键);
      return v === null ? 兜底 : v;
    } catch (e) { return 兜底; }
  }

  function 写存储(键, 值) {
    try { localStorage.setItem(键, 值); } catch (e) { /* 隐私模式忽略 */ }
  }

  function 取后端() {
    var v = (el.backend.value || '').trim().replace(/\/+$/, '');
    return v || 默认后端;
  }

  function 取路径() {
    // 配置中的自定义路径优先，其次 UUID
    var 自定义 = 当前配置.d;
    if (自定义 && 自定义.trim()) return 自定义.trim().replace(/^\/+|\/+$/g, '');
    return (el.uuid.value || '').trim().replace(/^\/+|\/+$/g, '');
  }

  function 提示(元素, 文字, 类型) {
    if (!文字) { 元素.hidden = true; return; }
    元素.hidden = false;
    元素.textContent = 文字;
    元素.className = 'notice' + (类型 ? ' ' + 类型 : '');
  }

  function 设连接(状态, 文字) {
    el.dotConn.className = 'dot' + (状态 ? ' ' +状态 : '');
    el.txtConn.textContent = 文字;
  }

  function 设地区(状态, 文字) {
    el.dotRegion.className = 'dot' + (状态 ? ' ' + 状态 : '');
    el.txtRegion.textContent = 文字;
  }

  // 统一的 API 请求：自动计时 + 错误归一 + 预检由浏览器自动处理
  function 请求(路径, 选项) {
    var 起点 = Date.now();
    var 地址 = 取后端() + 路径;
    选项 = 选项 || {};
    var 配置 = {
      method: 选项.method || 'GET',
      cache: 'no-store',
      headers: {}
    };
    if (选项.body !== undefined) {
      配置.headers['Content-Type'] = 'application/json';
      配置.body = JSON.stringify(选项.body);
    }
    if (选项.文本) {
      配置.headers['Accept'] = '*/*';
    } else {
      配置.headers['Accept'] = 'application/json';
    }
    return fetch(地址, 配置).then(function (响应) {
      var 耗时 = Date.now() - 起点;
      el.txtLatency.textContent = 耗时 + ' ms';
      if (!响应.ok) {
        // 尽量读出后端的错误说明，便于定位（如路径验证失败 / KV 未配置）
        return 响应.text().then(function (t) {
          var e = new Error(提取错误(t) || ('HTTP ' + 响应.status));
          e.status = 响应.status;
          throw e;
        }, function () {
          var e = new Error('HTTP ' + 响应.status);
          e.status = 响应.status;
          throw e;
        });
      }
      if (选项.文本) return 响应.text();
      return 响应.json();
    });
  }

  function 提取错误(文本) {
    if (!文本) return '';
    try {
      var d = JSON.parse(文本);
      return d.message || d.error || '';
    } catch (e) {
      return 文本.slice(0, 120);
    }
  }

  function 忙碌(开) {
    [el.btnSub, el.btnRegion, el.btnPing, el.btnSave, el.btnLoad, el.btnTest].forEach(function (b) {
      if (b) b.disabled = !!开;
    });
    if (!开 && el.btnStop) el.btnStop.disabled = true;
  }

  /* ==================== Tab 切换 ==================== */

  function 切换Tab(名) {
    var 是订阅 = 名 === 'sub';
    el.tabSub.classList.toggle('active', 是订阅);
    el.tabConfig.classList.toggle('active', !是订阅);
    el.tabSub.setAttribute('aria-selected', 是订阅 ? 'true' : 'false');
    el.tabConfig.setAttribute('aria-selected', 是订阅 ? 'false' : 'true');
    el.panelSub.hidden = !是订阅;
    el.panelConfig.hidden = 是订阅;
    if (!是订阅) {
      // 首次进入配置页时自动拉取一次现有配置
      if (!已加载配置) 加载配置(true);
    }
  }

  /* ==================== 订阅获取 ==================== */

  var 当前配置 = {};

  function 检测后端() {
    设连接('', '检测中…');
    return 请求('/').then(function (数据) {
      设连接('ok', '已连接');
      el.tagVer.textContent = (数据 && 数据.status) || 'ok';
      return 数据;
    }).catch(function (e) {
      设连接('err', '连接失败');
      el.tagVer.textContent = '—';
      throw e;
    });
  }

  function 获取订阅() {
    var p = 取路径();
    if (!p) { 提示(el.notice, '请先填写 UUID 或自定义路径', 'err'); return Promise.resolve(); }
    忙碌(true);
    提示(el.notice, '正在获取订阅…');
    el.result.hidden = true;

    return 请求('/' + p + '/sub', { 文本: true }).then(function (文本) {
      el.result.hidden = false;
      el.result.textContent = 文本.length > 4000 ? 文本.slice(0, 4000) + '\n…（内容较长，已截断）' : 文本;
      提示(el.notice, '订阅链接：' + 取后端() + '/' + p + '/sub', 'ok');
      设连接('ok', '已连接');
    }).catch(function (e) {
      提示(el.notice, '获取订阅失败：' + e.message, 'err');
      设连接('err', '连接失败');
    }).then(function (v) { 忙碌(false); return v; });
  }

  function 查询地区() {
    var p = 取路径();
    if (!p) { 提示(el.notice, '请先填写 UUID 或自定义路径', 'err'); return Promise.resolve(); }
    忙碌(true);
    设地区('', '查询中…');
    提示(el.notice, '正在查询节点地区…');
    return 请求('/' + p + '/region').then(function (数据) {
      var 地区 = (数据 && 数据.region) || '未知';
      设地区('ok', 地区);
      提示(el.notice, '当前节点地区：' + 地区 + (数据 && 数据.detectionMethod ? '（' + 数据.detectionMethod + '）' : ''), 'ok');
    }).catch(function (e) {
      设地区('err', '查询失败');
      提示(el.notice, '查询地区失败：' + e.message, 'err');
    }).then(function (v) { 忙碌(false); return v; });
  }

  function 测试连接() {
    var p = 取路径();
    忙碌(true);
    提示(el.notice, '正在测试连接…');
    设连接('', '测试中…');
    return 请求(p ? '/' + p + '/test-api' : '/').then(function () {
      设连接('ok', '连通');
      提示(el.notice, '连接正常', 'ok');
    }).catch(function (e) {
      设连接('err', '无法连接');
      提示(el.notice, '连接失败：' + e.message, 'err');
    }).then(function (v) { 忙碌(false); return v; });
  }

  /* ==================== 配置管理 ==================== */

  var 已加载配置 = false;

  // 把后端返回的 yes/no 转为布尔
  function 是yes(值, 兜底) {
    if (值 === 'yes') return true;
    if (值 === 'no') return false;
    return !!兜底;
  }

  // 布尔 -> yes/no（空字符串表示不写入，沿用后端默认）
  function 转开关(勾选, 字段) {
    var 后端默认 = 是yes(默认配置[字段], false);
    // 与默认值相同时写空串，避免覆盖后端语义
    return 勾选 === 后端默认 ? '' : (勾选 ? 'yes' : 'no');
  }

  function 填表单(配置) {
    Object.keys(默认配置).forEach(function (字段) {
      var 节点 = document.querySelector('[data-key="' + 字段 + '"]');
      if (!节点) return;
      var 值 = 配置[字段];
      if (值 === undefined || 值 === null) 值 = 默认配置[字段];
      if (节点.type === 'checkbox') {
        节点.checked = 是yes(值, 是yes(默认配置[字段], false));
      } else {
        节点.value = 值 === undefined || 值 === null ? '' : 值;
      }
    });
  }

  function 读表单() {
    var 出 = {};
    document.querySelectorAll('[data-key]').forEach(function (节点) {
      var 字段 = 节点.getAttribute('data-key');
      if (节点.type === 'checkbox') {
        出[字段] = 转开关(节点.checked, 字段);
      } else {
        出[字段] = (节点.value || '').trim();
      }
    });
    return 出;
  }

  function 加载配置(静默) {
    var p = 取路径();
    if (!p) {
      提示(el.cfgNotice, '请先在「订阅获取」页填写 UUID 或自定义路径', 'err');
      return Promise.resolve();
    }
    忙碌(true);
    if (!静默) 提示(el.cfgNotice, '正在加载配置…');
    return 请求('/' + p + '/api/config').then(function (数据) {
      if (数据 && 数据.kvEnabled === false) {
        throw new Error('后端未配置 KV 存储，无法使用配置管理');
      }
      当前配置 = 数据 || {};
      填表单(当前配置);
      已加载配置 = true;
      提示(el.cfgNotice, '配置已加载（' + Object.keys(当前配置).length + ' 项）', 'ok');
    }).catch(function (e) {
      提示(el.cfgNotice, '加载失败：' + e.message, 'err');
    }).then(function (v) { 忙碌(false); return v; });
  }

  function 保存配置() {
    var p = 取路径();
    if (!p) {
      提示(el.cfgNotice, '请先在「订阅获取」页填写 UUID 或自定义路径', 'err');
      return Promise.resolve();
    }
    var 配置 = 读表单();
    // 至少一个协议，否则后端会自动回退到 VLESS
    if (配置.ev === 'no' && 配置.et === 'no' && 配置.ex === 'no') {
      提示(el.cfgNotice, '三个协议不能同时关闭，已自动保留 VLESS', 'err');
      var ev节点 = document.querySelector('[data-key="ev"]');
      if (ev节点) { ev节点.checked = true; 配置.ev = 'yes'; }
    }
    忙碌(true);
    提示(el.cfgNotice, '正在保存…');
    return 请求('/' + p + '/api/config', { method: 'POST', body: 配置 }).then(function (数据) {
      if (数据 && 数据.success) {
        当前配置 = 数据.config || 当前配置;
        提示(el.cfgNotice, '配置已保存', 'ok');
        读入优选列表();
      } else {
        提示(el.cfgNotice, '保存失败：' + ((数据 && 数据.message) || '未知错误'), 'err');
      }
    }).catch(function (e) {
      提示(el.cfgNotice, '保存失败：' + e.message, 'err');
    }).then(function (v) { 忙碌(false); return v; });
  }

  // 读取后端现有优选 IP 列表
  function 读入优选列表() {
    var p = 取路径();
    if (!p) return Promise.resolve();
    return 请求('/' + p + '/api/preferred-ips').then(function (数据) {
      if (数据 && 数据.success && Array.isArray(数据.data)) {
        // 仅在表单为空时回填，避免覆盖用户正在编辑的内容
        var yx节点 = document.querySelector('[data-key="yx"]');
        if (yx节点 && !yx节点.value.trim() && 数据.data.length) {
          yx节点.value = 数据.data.map(function (项) {
            return 项.ip + (项.port ? ':' + 项.port : '') + (项.name ? '#' + 项.name : '');
          }).join(',');
        }
      }
    }).catch(function (e) {
      // 该接口需后端开启「允许API管理」，失败不打扰用户
      if (e && e.status === 403) {
        提示(el.testNotice, '提示：后端未开启「允许API管理」，无法使用优选列表接口', 'err');
      }
    });
  }

  /* ==================== 延迟测试 ==================== */

  // 单个节点测速：直连 *.nip.lfree.org，与原配置页实现一致
  function 测单个(地址, 端口, 信号) {
    return new Promise(function (resolve) {
      var 控制器 = new AbortController();
      var 超时 = setTimeout(function () { 控制器.abort(); }, 8000);
      if (信号) {
        信号.addEventListener('abort', function () { 控制器.abort(); }, { once: true });
      }
      var 清理 = String(地址).replace(/^\[|\]$/g, '');
      var 测试域名 = 清理 + '.nip.lfree.org';
      var 网址 = 'https://' + 测试域名 + ':' + 端口 + '/';
      var 起点 = Date.now();
      fetch(网址, { signal: 控制器.signal, mode: 'cors', cache: 'no-store' })
        .then(function (r) {
          clearTimeout(超时);
          var 耗时 = Date.now() - 起点;
          if (!r.ok) { resolve({ 地址: 地址, 延迟: null, 成功: false }); return; }
          resolve({ 地址: 地址, 延迟: 耗时, 成功: true });
        })
        .catch(function () {
          clearTimeout(超时);
          resolve({ 地址: 地址, 延迟: null, 成功: false });
        });
    });
  }

  function 渲染测试结果() {
    var 体 = el.testResultBody;
    体.innerHTML = '';
    if (!测试结果.length) {
      var 空 = document.createElement('div');
      空.className = 'empty';
      空.textContent = '暂无测试结果';
      体.appendChild(空);
      el.testResults.hidden = false;
      return;
    }
    // 成功的按延迟升序在前，失败的排后面
    var 排序 = 测试结果.slice().sort(function (a, b) {
      if (a.成功 && b.成功) return a.延迟 - b.延迟;
      if (a.成功) return -1;
      if (b.成功) return 1;
      return 0;
    });
    排序.forEach(function (r) {
      var 行 = document.createElement('div');
      行.className = 'result-item';
      行.setAttribute('data-addr', r.地址);
      行.setAttribute('data-lat', r.延迟 === null ? '' : r.延迟);

      var 地址格 = document.createElement('span');
      地址格.className = 'c-addr';
      地址格.textContent = r.地址;
      行.appendChild(地址格);

      var 延迟格 = document.createElement('span');
      延迟格.className = 'c-lat';
      if (r.成功) {
        var 标签 = document.createElement('span');
        标签.className = 'tag ' + (r.延迟 < 300 ? 'ok' : (r.延迟 < 800 ? 'warn' : 'err'));
        标签.textContent = r.延迟 + ' ms';
        延迟格.appendChild(标签);
      } else {
        var 失败 = document.createElement('span');
        失败.className = 'tag err';
        失败.textContent = '失败';
        延迟格.appendChild(失败);
      }
      行.appendChild(延迟格);

      var 操作格 = document.createElement('span');
      操作格.className = 'c-act';
      var 选中 = document.createElement('input');
      选中.type = 'checkbox';
      选中.checked = r.成功;
      选中.disabled = !r.成功;
      选中.setAttribute('aria-label', '选择 ' + r.地址);
      操作格.appendChild(选中);
      行.appendChild(操作格);

      体.appendChild(行);
    });
    el.testResults.hidden = false;
  }

  function 选中项() {
    var 选中 = [];
    el.testResultBody.querySelectorAll('.result-item').forEach(function (行) {
      var 框 = 行.querySelector('input[type="checkbox"]');
      if (框 && 框.checked) {
        选中.push({ 地址: 行.getAttribute('data-addr'), 延迟: parseInt(行.getAttribute('data-lat'), 10) || 0 });
      }
    });
    return 选中;
  }

  function 开始测试() {
    var 原始 = (el.testInput.value || '').split(/[\n,，\s]+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    if (!原始.length) {
      提示(el.testNotice, '请先填写待测地址，每行一个', 'err');
      return;
    }
    var 端口 = (el.testPort.value || '443').trim() || '443';

    测试结果 = [];
    渲染测试结果();
    el.progress.hidden = false;
    el.progressBar.style.width = '0%';
    el.btnTest.disabled = true;
    el.btnStop.disabled = false;
    el.btnOverwrite.disabled = true;
    el.btnAppend.disabled = true;
    提示(el.testNotice, '正在测试 0 / ' + 原始.length + '…');

    测试控制器 = new AbortController();
    var 信号 = 测试控制器.signal;
    var 完成 = 0;
    var 并发 = 5;   // 并发数，避免一次开太多请求被浏览器限流

    var 队列 = 原始.slice();

    function 下一个() {
      if (信号.aborted) return Promise.resolve();
      var 地址 = 队列.shift();
      if (!地址) return Promise.resolve();
      return 测单个(地址, 端口, 信号).then(function (r) {
        测试结果.push(r);
        完成++;
        var 百分比 = Math.round(完成 / 原始.length * 100);
        el.progressBar.style.width = 百分比 + '%';
        var 成功数 = 测试结果.filter(function (x) { return x.成功; }).length;
        提示(el.testNotice, '测试中 ' + 完成 + ' / ' + 原始.length + '（成功 ' + 成功数 + '）');
        return 下一个();
      });
    }

    var 任务 = [];
    for (var i = 0; i < 并发; i++) 任务.push(下一个());

    return Promise.all(任务).then(function () {
      var 成功数 = 测试结果.filter(function (x) { return x.成功; }).length;
      el.progress.hidden = true;
      el.btnTest.disabled = false;
      el.btnStop.disabled = true;
      测试控制器 = null;
      渲染测试结果();
      var 有成功 = 成功数 > 0;
      el.btnOverwrite.disabled = !有成功;
      el.btnAppend.disabled = !有成功;
      提示(el.testNotice,
        信号.aborted ? '测试已停止（成功 ' + 成功数 + ' / ' + 测试结果.length + '）'
          : '测试完成：成功 ' + 成功数 + ' / ' + 测试结果.length,
        有成功 ? 'ok' : 'err');
    });
  }

  function 停止测试() {
    if (测试控制器) {
      测试控制器.abort();
      el.btnStop.disabled = true;
    }
  }

  // 把选中项写入 yx 字段（覆盖 or 追加），随后保存到后端
  function 写入优选(覆盖) {
    var 选中 = 选中项();
    if (!选中.length) {
      提示(el.testNotice, '请先在结果中勾选要添加的地址', 'err');
      return;
    }
    var 端口 = (el.testPort.value || '443').trim() || '443';
    var 新片段 = 选中.map(function (r) {
      return r.地址 + ':' + 端口 + '#CF优选 ' + (r.延迟 || 0) + 'ms';
    });

    var yx节点 = document.querySelector('[data-key="yx"]');
    if (!yx节点) return;

    if (覆盖) {
      yx节点.value = 新片段.join(',');
      提示(el.testNotice, '已覆盖优选列表为 ' + 新片段.length + ' 条，点「保存配置」提交', 'ok');
    } else {
      var 原有 = (yx节点.value || '').trim();
      yx节点.value = 原有 ? 原有 + ',' + 新片段.join(',') : 新片段.join(',');
      提示(el.testNotice, '已追加 ' + 新片段.length + ' 条到优选列表，点「保存配置」提交', 'ok');
    }
  }

  /* ==================== 事件绑定 ==================== */

  function 初始化元素() {
    [
      'backend', 'uuid', 'btnSub', 'btnRegion', 'btnPing', 'notice', 'result',
      'dotConn', 'txtConn', 'dotRegion', 'txtRegion', 'txtLatency', 'tagVer',
      'tabSub', 'tabConfig', 'panelSub', 'panelConfig',
      'btnLoad', 'btnSave', 'cfgNotice',
      'testInput', 'testPort', 'btnTest', 'btnStop', 'testNotice', 'progress',
      'progressBar', 'testResults', 'testResultBody', 'btnOverwrite', 'btnAppend'
    ].forEach(function (id) { el[id] = $(id); });
  }

  function 绑定事件() {
    el.tabSub.addEventListener('click', function () { 切换Tab('sub'); });
    el.tabConfig.addEventListener('click', function () { 切换Tab('config'); });

    el.btnSub.addEventListener('click', function () {
      获取订阅().then(function () { if (取路径()) 查询地区(); });
    });
    el.btnRegion.addEventListener('click', 查询地区);
    el.btnPing.addEventListener('click', 测试连接);

    el.btnLoad.addEventListener('click', function () { 加载配置(false); });
    el.btnSave.addEventListener('click', 保存配置);

    el.btnTest.addEventListener('click', 开始测试);
    el.btnStop.addEventListener('click', 停止测试);
    el.btnOverwrite.addEventListener('click', function () { 写入优选(true); });
    el.btnAppend.addEventListener('click', function () { 写入优选(false); });

    el.uuid.addEventListener('keypress', function (e) { if (e.key === 'Enter') el.btnSub.click(); });
    el.backend.addEventListener('keypress', function (e) { if (e.key === 'Enter') el.btnPing.click(); });

    el.backend.addEventListener('change', function () { 写存储(存储键.backend, 取后端()); });
    el.uuid.addEventListener('change', function () { 写存储(存储键.uuid, el.uuid.value.trim()); });
    el.testInput.addEventListener('input', function () { 写存储(存储键.testInput, this.value); });
    el.testPort.addEventListener('input', function () { 写存储(存储键.testPort, this.value); });

    // 自定义路径（d）变更会影响 API 基址，保存后重新加载列表
    var d节点 = document.querySelector('[data-key="d"]');
    if (d节点) {
      d节点.addEventListener('change', function () {
        if (已加载配置) 读入优选列表();
      });
    }
  }

  function 初始化() {
    初始化元素();
    绑定事件();

    el.backend.value = 读存储(存储键.backend, 默认后端);
    el.uuid.value = 读存储(存储键.uuid, '');
    el.testInput.value = 读存储(存储键.testInput, '');
    el.testPort.value = 读存储(存储键.testPort, '443');

    检测后端().catch(function () {
      提示(el.notice, '后端检测失败，请确认地址是否正确', 'err');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', 初始化);
  } else {
    初始化();
  }
})();
