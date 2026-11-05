// dsh-space-ptt · 浏览器半边
//
// 给「语音输入」插件配一个对讲机键：
//   按住空格 → 开始录音；松手 → 停止并识别 → 直接发送。
//
// 三条不越界的原则：
//   1. 只在输入框空着的时候接管空格。输入框已经有字，空格就是空格。
//   2. 找不到麦克风按钮（语音插件没开 / 模型没准备好）就完全不接管，空格照常。
//   3. 识别不出东西就不发。宁可把转写留在草稿里让你自己处理，也不发一条空的。
//
// 依赖的是语音插件自己的 aria-label，不是内部 API：
//   开始录音 / 停止并识别 / 取消   ← @deepseek-ai/dsh-experimental-client-ui-voice-input
//   发送消息 / 排队发送 / 插话发送 ← @deepseek-ai/dsh-client-ui-conversation
window.__ModuleLoader__.load({
  id: 'dsh-space-ptt',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ---- 可调参数 ----------------------------------------------------
    const AUTO_SEND = true        // false = 只转写进草稿，不自动发送
    const MIN_HOLD_MS = 250       // 按得比这还短，当误触，取消而不是发送
    const STOP_TIMEOUT_MS = 30000 // 停止后最多等多久的识别结果
    const POLL_MS = 120
    const GLOBAL_SPACE = true     // true = 不用点输入框，键盘不在输入框里按空格也能说话
    const SKIP_WHEN_DIALOG = true // 有弹窗/对话框时不抢空格
    // ------------------------------------------------------------------

    const SEL_START = ['[aria-label="开始录音"]', '[aria-label="Start recording"]']
    const SEL_STOP = ['[aria-label="停止并识别"]', '[aria-label="Stop and transcribe"]']
    const SEL_CANCEL = ['[aria-label="取消"]', '[aria-label="Cancel"]']
    const SEL_SEND = [
      '[aria-label="发送消息"]',
      '[aria-label="排队发送"]',
      '[aria-label="插话发送"]',
      '[aria-label="Send message"]',
      '[aria-label="Queue message"]',
      '[aria-label="Steer message"]',
    ]
    // 识别完不会自动插进输入框，而是先出一个「插入文字」按钮，得点它一下
    const SEL_INSERT = [
      '[aria-label="插入文字"]',
      '[aria-label="Insert text"]',
      '[aria-label="Insert"]',
    ]

    const log = (...a) => console.log('[space-ptt]', ...a)
    const warn = (...a) => console.warn('[space-ptt]', ...a)

    const visible = (el) =>
      !!el && el.isConnected && (el.offsetParent !== null || el.getClientRects().length > 0)

    const usable = (el) =>
      visible(el) &&
      !el.disabled &&
      el.getAttribute('aria-disabled') !== 'true'

    function pick(sels, { needUsable = true } = {}) {
      for (const sel of sels) {
        const nodes = document.querySelectorAll(sel)
        for (const el of nodes) if (needUsable ? usable(el) : visible(el)) return el
      }
      return null
    }

    // 输入框可能是 textarea，也可能是 Lexical 的 contenteditable
    function composerOf(el) {
      if (!el || el.nodeType !== 1) return null
      if (el.tagName === 'TEXTAREA') return el
      if (typeof el.closest === 'function') {
        const ce = el.closest('[contenteditable="true"]')
        if (ce) return ce
      }
      return null
    }

    function readText(el) {
      if (!el || !el.isConnected) return ''
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || ''
      return el.innerText || el.textContent || ''
    }

    // 录音条上的「取消」：只在停止按钮所在的那一小块里找，避免误点别的弹窗
    function cancelNear(stopBtn) {
      let node = stopBtn
      for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
        for (const sel of SEL_CANCEL) {
          const el = node.querySelector(sel)
          if (el && usable(el)) return el
        }
      }
      return null
    }

    // 取消本次录音：优先点录音条上的「取消」，没有就点停止
    function cancelRecording() {
      const stop = pick(SEL_STOP, { needUsable: false })
      const cancel = stop ? cancelNear(stop) : null
      if (cancel) cancel.click()
      else if (stop) stop.click()
      reset()
      log('已取消本次录音')
    }

    // ---- 状态机 ------------------------------------------------------
    let state = 'idle' // idle | recording | waiting
    let heldAt = 0
    let composer = null
    let poller = 0

    function clearPoll() {
      if (poller) clearInterval(poller)
      poller = 0
    }

    function reset() {
      clearPoll()
      state = 'idle'
      composer = null
    }

    // 停止之后：等录音条收起（=识别完），再确认草稿真有字，才按发送
    function waitThenSend() {
      state = 'waiting'
      const deadline = Date.now() + STOP_TIMEOUT_MS
      clearPoll()
      poller = setInterval(() => {
        if (Date.now() > deadline) {
          warn('识别超时，转写结果留在草稿里，没有自动发送')
          reset()
          return
        }

        // 如果语音插件改成了「手动插入」模式（草稿被改动过），就替用户点一下
        const insert = pick(SEL_INSERT, { needUsable: false })
        if (insert && usable(insert)) {
          insert.click()
          log('已点「插入文字」')
          return
        }

        // 录音条还在 = 还在识别
        if (pick(SEL_STOP, { needUsable: false })) return

        // 录音期间编辑器可能整块重建，节点失效就重新找一次
        if (!composer || !composer.isConnected) {
          composer = document.querySelector('[contenteditable="true"], textarea')
        }
        const text = readText(composer).trim()
        if (!text) return // 识别为空（或还在插入），继续等

        if (!AUTO_SEND) {
          log('已转写，按设置不自动发送')
          reset()
          return
        }

        const send = pick(SEL_SEND)
        if (!send) return // 发送按钮还没亮，再等等

        clearPoll()
        state = 'idle'
        setTimeout(() => {
          const btn = pick(SEL_SEND)
          if (btn && readText(composer).trim()) {
            btn.click()
            log('已发送')
          }
          composer = null
        }, 50)
      }, POLL_MS)
    }

    function onKeyDown(e) {
      // 录音中：按住产生的重复 keydown 必须继续拦，否则空格会灌进输入框
      // （一旦草稿被改，语音插件就不肯自动插入了，只能手动点「插入文字」）
      if (state !== 'idle') {
        if (e.code === 'Space') {
          e.preventDefault()
          e.stopPropagation()
        } else if (state === 'recording' && e.code === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelRecording()
        }
        return
      }
      if (e.code !== 'Space') return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.repeat) return
      if (e.isComposing) return // 中文输入法选词时空格不能抢

      const active = document.activeElement
      const editing =
        composerOf(active) ||
        (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) ||
        (active && active.isContentEditable)

      let el = null
      if (editing) {
        // 正在输入：只有输入框空着才接管，否则空格照常还给用户
        el = composerOf(active) || (active && active.tagName === 'TEXTAREA' ? active : null)
        if (!el) return
        if (readText(el).trim()) return
      } else {
        // 全局模式：焦点不在输入框（刚打开软件、点在页面空白/消息列表上）也能直接按住说话
        if (!GLOBAL_SPACE) return
        if (SKIP_WHEN_DIALOG) {
          const dlg = document.querySelector('[role="dialog"], [aria-modal="true"]')
          if (dlg && visible(dlg)) return
        }
        el = document.querySelector('[contenteditable="true"], textarea')
        if (!el) return
        if (readText(el).trim()) return // 草稿里已经有字，别硬塞
        try { el.focus() } catch {}
      }

      const start = pick(SEL_START)
      if (!start) return // 语音输入没就绪：不接管

      e.preventDefault()
      e.stopPropagation() // 拦住 Lexical，别让空格真的打进去
      composer = el
      heldAt = Date.now()
      state = 'recording'
      start.click()
    }

    function onKeyUp(e) {
      if (state !== 'recording') return
      if (e.code !== 'Space') return
      e.preventDefault()
      e.stopPropagation()

      const stop = pick(SEL_STOP, { needUsable: false })
      const held = Date.now() - heldAt

      // 太短：当误触，取消录音，不发送
      if (held < MIN_HOLD_MS) {
        cancelRecording()
        return
      }

      if (!stop) {
        warn('没找到停止按钮，放弃本次录音')
        reset()
        return
      }
      stop.click()
      waitThenSend()
    }

    function install() {
      document.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('keyup', onKeyUp, true)
      // 按住期间切走窗口（Alt+Tab）：keyup 会丢，录音会一直挂着，这里兜底取消
      const onBlur = () => { if (state === 'recording') cancelRecording() }
      window.addEventListener('blur', onBlur)
      log('已装载：按住空格说话（不用先点输入框），松手自动发送')
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('keyup', onKeyUp, true)
        window.removeEventListener('blur', onBlur)
        reset()
      }
    }

    function apply(ctx) {
      ctx.effect(() => install())
    }

    exports.isPlugin = true
    exports.inject = []
    exports.apply = apply
    return module.exports
  },
})
