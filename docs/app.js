/* cf123 前端交互逻辑
   后端接口：
     GET /                      健康检查 -> { status, message }
     GET /<UUID>/sub            订阅内容
     GET /<UUID>/region         节点地区 -> { region, detectionMethod, ... }
     GET /<UUID>/test-api       连通性测试
   后端已开启 CORS（Access-Control-Allow-Origin: *），可跨域调用。 */

(function () {
  'use strict';

  var 默认后端 = 'https://cf123-1ju.pages.dev';
  var 存储键 = 'cf123.backend';

  var el = {
    backend: document.getElementById('backend'),
    uuid: document.getElementById('uuid'),
    btnSub: document.getElementById('btnSub'),
    btnRegion: document.getElementById('btnRegion'),
    btnPing: document.getElementById('btnPing'),
    notice: document.getElementById('notice'),
    result: document.getElementById('result'),
    dotConn: document.getElementById('dotConn'),
    txtConn: document.getElementById('txtConn'),
    dotRegion: document.getElementById('dotRegion'),
    txtRegion: document.getElementById('txtRegion'),
    txtLatency: document.getElementById('txtLatency'),
    tagVer: document.getElementById('tagVer')
  };

  /* ---------- 工具 ---------- */

  function 取后端() {
    var v = (el.backend.value || '').trim().replace(/\/+$/, '');
    return v || 默认后端;
  }

  function 取UUID() {
    return (el.uuid.value || '').trim().replace(/^\/+|\/+$/g, '');
  }

  // 设置「圆点 + 文字」状态：连接
  function 设连接(状态, 文字) {
    el.dotConn.className = 'dot' + (状态 ? ' ' + 状态 : '');
    el.txtConn.textContent = 文字;
  }

  function 设地区(状态, 文字) {
    el.dotRegion.className = 'dot' + (状态 ? ' ' + 状态 : '');
    el.txtRegion.textContent = 文字;
  }

  function 提示(文字, 是错误) {
    if (!文字) {
      el.notice.hidden = true;
      return;
    }
    el.notice.hidden = false;
    el.notice.textContent = 文字;
    el.notice.className = 'notice' + (是错误 ? ' err' : '');
  }

  function 显示结果(文字) {
    el.result.hidden = false;
    el.result.textContent = 文字;
  }

  function 隐藏结果() {
    el.result.hidden = true;
    el.result.textContent = '';
  }

  function 忙碌(开) {
    [el.btnSub, el.btnRegion, el.btnPing].forEach(function (b) {
      b.disabled = !!开;
    });
  }

  // 统一的 fetch 包装：自动计时 + 错误归一
  function 请求(路径) {
    var 起点 = Date.now();
    var 后端 = 取后端();
    var 地址 = 后端 + 路径;
    return fetch(地址, {
      method: 'GET',
      headers: { 'Accept': '*/*' },
      cache: 'no-store',
      redirect: 'follow'
    }).then(function (响应) {
      var 耗时 = Date.now() - 起点;
      el.txtLatency.textContent = 耗时 + ' ms';
      if (!响应.ok) {
        var e = new Error('HTTP ' + 响应.status);
        e.status = 响应.status;
        throw e;
      }
      return { 响应: 响应, 耗时: 耗时, 地址: 地址 };
    });
  }

  /* ---------- 操作 ---------- */

  // 健康检查：GET /
  function 检测后端() {
    设连接('', '检测中…');
    el.tagVer.textContent = '—';
    return 请求('/').then(function (r) {
      return r.响应.json().then(function (数据) {
        设连接('ok', '已连接');
        if (数据 && 数据.status) {
          el.tagVer.textContent = 数据.status;
        }
        return 数据;
      });
    }).catch(function (e) {
      设连接('err', '连接失败');
      el.tagVer.textContent = '—';
      throw e;
    });
  }

  // 订阅：GET /<UUID>/sub
  function 获取订阅() {
    var uuid = 取UUID();
    if (!uuid) {
      提示('请先填写 UUID 或自定义路径', true);
      return Promise.resolve();
    }
    忙碌(true);
    提示('正在获取订阅…', false);
    隐藏结果();

    var 路径 = '/' + uuid + '/sub';
    return 请求(路径).then(function (r) {
      return r.响应.text().then(function (文本) {
        显示结果(文本.slice(0, 2000));
        提示('订阅链接：' + r.地址, false);
        设连接('ok', '已连接');
        return 文本;
      });
    }).catch(function (e) {
      提示('获取订阅失败：' + (e && e.message ? e.message : '未知错误'), true);
      设连接('err', '连接失败');
    }).then(function (v) {
      忙碌(false);
      return v;
    });
  }

  // 地区：GET /<UUID>/region
  function 查询地区() {
    var uuid = 取UUID();
    if (!uuid) {
      提示('请先填写 UUID 或自定义路径', true);
      return Promise.resolve();
    }
    忙碌(true);
    设地区('', '查询中…');
    提示('正在查询节点地区…', false);

    return 请求('/' + uuid + '/region').then(function (r) {
      return r.响应.json().then(function (数据) {
        var 地区 = 数据 && 数据.region ? 数据.region : '未知';
        设地区('ok', 地区);
        var 方式 = 数据 && 数据.detectionMethod ? '（' + 数据.detectionMethod + '）' : '';
        提示('当前节点地区：' + 地区 + 方式, false);
        return 数据;
      });
    }).catch(function (e) {
      设地区('err', '查询失败');
      提示('查询地区失败：' + (e && e.message ? e.message : '未知错误'), true);
    }).then(function (v) {
      忙碌(false);
      return v;
    });
  }

  // 连通性：GET /<UUID>/test-api
  function 测试连接() {
    var uuid = 取UUID();
    忙碌(true);
    提示('正在测试连接…', false);
    设连接('', '测试中…');

    var 路径 = uuid ? '/' + uuid + '/test-api' : '/';
    return 请求(路径).then(function (r) {
      设连接('ok', '连通（' + r.耗时 + ' ms）');
      提示('连接正常，耗时 ' + r.耗时 + ' ms', false);
    }).catch(function (e) {
      设连接('err', '无法连接');
      提示('连接失败：' + (e && e.message ? e.message : '未知错误'), true);
    }).then(function (v) {
      忙碌(false);
      return v;
    });
  }

  /* ---------- 事件绑定 ---------- */

  el.btnSub.addEventListener('click', function () {
    获取订阅().then(function () {
      // 订阅成功后顺带更新地区
      if (取UUID()) {
        查询地区();
      }
    });
  });

  el.btnRegion.addEventListener('click', 查询地区);
  el.btnPing.addEventListener('click', 测试连接);

  // 回车快捷提交
  el.uuid.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      el.btnSub.click();
    }
  });
  el.backend.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      el.btnPing.click();
    }
  });

  // 记住后端地址
  el.backend.addEventListener('change', function () {
    try {
      localStorage.setItem(存储键, 取后端());
    } catch (err) { /* 隐私模式下忽略 */ }
  });

  /* ---------- 初始化 ---------- */

  (function 初始化() {
    var 记住的 = '';
    try {
      记住的 = localStorage.getItem(存储键) || '';
    } catch (err) { /* 忽略 */ }
    el.backend.value = 记住的 || 默认后端;

    // 首次进入自动检测一次后端
    检测后端().catch(function () {
      提示('后端检测失败，请确认地址是否正确', true);
    });
  })();
})();
