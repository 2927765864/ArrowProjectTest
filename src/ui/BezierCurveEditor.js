/**
 * BezierCurveEditor — 可视化三次贝塞尔曲线编辑器
 *
 * 用途：
 *   把回收命中爆体特效里 52 个 *AtMax 双端点参数收敛成 3 根可视化曲线（密度/运动/视觉）。
 *   每根曲线 = startScale (t=0 倍率) + endScale (t=1 倍率) + 三次贝塞尔形状 (p1, p2)。
 *
 * 模型：
 *   端点 (0,0) 与 (1,1) 固定，仅可拖拽 p1 / p2 两个控制点。
 *   y 轴方向：上为 1（视觉直觉），但内部坐标 y∈[0,1]（编辑器允许 y 略超出 [0,1] 用于 overshoot 形状）。
 *
 * 用法：
 *   const editor = new BezierCurveEditor(canvasEl, curveObj, { onChange, label });
 *   editor.refresh();   // 当外部 curveObj 被修改后手动刷新
 *   editor.destroy();
 *
 * curveObj 形如：
 *   { enabled: true, startScale: 1.0, endScale: 3.0,
 *     p1: { x: 0.42, y: 0.0 }, p2: { x: 0.58, y: 1.0 } }
 */

const PRESETS = {
    linear:    { p1: { x: 0.0,  y: 0.0  }, p2: { x: 1.0,  y: 1.0  } },
    easeIn:    { p1: { x: 0.42, y: 0.0  }, p2: { x: 1.0,  y: 1.0  } },
    easeOut:   { p1: { x: 0.0,  y: 0.0  }, p2: { x: 0.58, y: 1.0  } },
    smooth:    { p1: { x: 0.42, y: 0.0  }, p2: { x: 0.58, y: 1.0  } },
    smoother:  { p1: { x: 0.65, y: 0.0  }, p2: { x: 0.35, y: 1.0  } },
};

// 三次贝塞尔单值求值（按参数 u）
function bezierAt(p0, p1, p2, p3, u) {
    const iu = 1 - u;
    return iu * iu * iu * p0
        + 3 * iu * iu * u * p1
        + 3 * iu * u * u * p2
        + u * u * u * p3;
}

export class BezierCurveEditor {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} curve   { enabled, startScale, endScale, p1:{x,y}, p2:{x,y} }
     * @param {Object} [opts]
     * @param {function} [opts.onChange]  数据变化时回调
     * @param {string}   [opts.label]     标题（可选）
     */
    constructor(canvas, curve, opts = {}) {
        this.canvas = canvas;
        this.curve = curve;
        this.onChange = opts.onChange || (() => {});
        this.label = opts.label || '';

        // 内边距：留给数值轴和点击外侧的安全区
        this.pad = 14;
        this.activePoint = null; // 'p1' | 'p2' | null

        this._dpr = Math.max(1, window.devicePixelRatio || 1);
        this._resize();

        // 事件
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp   = this._onPointerUp.bind(this);
        this._onDblClick    = this._onDblClick.bind(this);

        // 关键：所有指针事件直接绑定到 canvas，配合 setPointerCapture 即可在拖拽
        // 期间持续收到 move/up 事件（即使指针移出 canvas 区域）。
        // 不能把 move/up 挂 window —— #control-panel 上有 stopPropagation
        // (ControlPanel.js 第 16 行) 会拦截事件冒泡到 document/window。
        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup',   this._onPointerUp);
        canvas.addEventListener('pointercancel', this._onPointerUp);
        canvas.addEventListener('lostpointercapture', this._onPointerUp);
        canvas.addEventListener('dblclick', this._onDblClick);

        // 阻止 canvas 上的指针事件穿透到面板（触屏滚动/缩放手势）
        canvas.style.touchAction = 'none';

        this.draw();
    }

    setCurve(curve) {
        this.curve = curve;
        this.draw();
    }

    refresh() { this.draw(); }

    destroy() {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup',   this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
        this.canvas.removeEventListener('lostpointercapture', this._onPointerUp);
        this.canvas.removeEventListener('dblclick', this._onDblClick);
    }

    applyPreset(name) {
        const p = PRESETS[name];
        if (!p) return;
        this.curve.p1.x = p.p1.x; this.curve.p1.y = p.p1.y;
        this.curve.p2.x = p.p2.x; this.curve.p2.y = p.p2.y;
        this.onChange();
        this.draw();
    }

    _resize() {
        const cssW = this.canvas.clientWidth || 200;
        const cssH = this.canvas.clientHeight || 160;
        this.canvas.width  = Math.round(cssW * this._dpr);
        this.canvas.height = Math.round(cssH * this._dpr);
    }

    // 数据坐标 (x∈[0,1], y∈[0,1]，y 向上) → canvas 像素坐标（y 向下）
    _toPx(x, y) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const pad = this.pad * this._dpr;
        const innerW = w - pad * 2;
        const innerH = h - pad * 2;
        return {
            x: pad + x * innerW,
            y: pad + (1 - y) * innerH,
        };
    }

    // 反向：canvas 像素 → 数据坐标
    _fromPx(px, py) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const pad = this.pad * this._dpr;
        const innerW = w - pad * 2;
        const innerH = h - pad * 2;
        const x = (px - pad) / innerW;
        const y = 1 - (py - pad) / innerH;
        return { x, y };
    }

    _eventToCanvasPx(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * this._dpr,
            y: (e.clientY - rect.top)  * this._dpr,
        };
    }

    _hitTest(px, py) {
        const HIT_R = 14 * this._dpr;
        for (const key of ['p1', 'p2']) {
            const p = this.curve[key];
            const ppx = this._toPx(p.x, p.y);
            const dx = ppx.x - px;
            const dy = ppx.y - py;
            if (dx * dx + dy * dy <= HIT_R * HIT_R) return key;
        }
        return null;
    }

    _onPointerDown(e) {
        const { x: px, y: py } = this._eventToCanvasPx(e);
        const hit = this._hitTest(px, py);
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        this.activePoint = hit;
        this._activePointerId = e.pointerId;
        // 关键：捕获指针，让后续 move/up 事件持续投递到 canvas，即使指针移出 canvas 边界
        try { this.canvas.setPointerCapture?.(e.pointerId); } catch (_) {}
        this.draw();
    }

    _onPointerMove(e) {
        if (!this.activePoint) return;
        // 多点触控时只跟踪激活的那个指针
        if (this._activePointerId !== undefined && e.pointerId !== this._activePointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const { x: px, y: py } = this._eventToCanvasPx(e);
        const { x, y } = this._fromPx(px, py);
        // 控制点 x 限制在 [0,1]，y 允许 [-0.3, 1.3] 用于 overshoot 形状
        const p = this.curve[this.activePoint];
        p.x = Math.max(0, Math.min(1, x));
        p.y = Math.max(-0.3, Math.min(1.3, y));
        this.onChange();
        this.draw();
    }

    _onPointerUp(e) {
        if (!this.activePoint) return;
        if (this._activePointerId !== undefined && e.pointerId !== this._activePointerId) return;
        this.activePoint = null;
        this._activePointerId = undefined;
        try { this.canvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
        this.draw();
    }

    _onDblClick(e) {
        const { x: px, y: py } = this._eventToCanvasPx(e);
        const hit = this._hitTest(px, py);
        if (!hit) return;
        e.preventDefault();
        // 双击重置为 linear 形状对应位置
        if (hit === 'p1') { this.curve.p1.x = 0.0; this.curve.p1.y = 0.0; }
        else              { this.curve.p2.x = 1.0; this.curve.p2.y = 1.0; }
        this.onChange();
        this.draw();
    }

    draw() {
        const ctx = this.canvas.getContext('2d');
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, w, h);

        // 网格（4×4）
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1 * this._dpr;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            const a = this._toPx(0, t); const b = this._toPx(1, t);
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            const c = this._toPx(t, 0); const d = this._toPx(t, 1);
            ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, d.y);
        }
        ctx.stroke();

        // 端点 (0,0)/(1,1) 连线提示（淡）
        const o0 = this._toPx(0, 0);
        const o1 = this._toPx(1, 1);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.moveTo(o0.x, o0.y);
        ctx.lineTo(o1.x, o1.y);
        ctx.stroke();

        // 控制把手（端点 → p1，端点 → p2）虚线
        const p1 = this._toPx(this.curve.p1.x, this.curve.p1.y);
        const p2 = this._toPx(this.curve.p2.x, this.curve.p2.y);
        ctx.setLineDash([4 * this._dpr, 4 * this._dpr]);
        ctx.strokeStyle = 'rgba(145, 197, 58, 0.45)';
        ctx.beginPath();
        ctx.moveTo(o0.x, o0.y); ctx.lineTo(p1.x, p1.y);
        ctx.moveTo(o1.x, o1.y); ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // 贝塞尔曲线本体
        ctx.strokeStyle = '#91c53a';
        ctx.lineWidth = 2 * this._dpr;
        ctx.beginPath();
        const SEG = 48;
        for (let i = 0; i <= SEG; i++) {
            const u = i / SEG;
            const x = bezierAt(0, this.curve.p1.x, this.curve.p2.x, 1, u);
            const y = bezierAt(0, this.curve.p1.y, this.curve.p2.y, 1, u);
            const px = this._toPx(x, y);
            if (i === 0) ctx.moveTo(px.x, px.y);
            else         ctx.lineTo(px.x, px.y);
        }
        ctx.stroke();

        // 端点（小白点）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        for (const ep of [o0, o1]) {
            ctx.beginPath();
            ctx.arc(ep.x, ep.y, 3 * this._dpr, 0, Math.PI * 2);
            ctx.fill();
        }

        // 控制点（绿色填充 + 白边）
        for (const [pos, key] of [[p1, 'p1'], [p2, 'p2']]) {
            ctx.fillStyle = this.activePoint === key ? '#cbe88b' : '#91c53a';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 2 * this._dpr;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 6 * this._dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // 端点倍率标注：左下显示 ×startScale，右上显示 ×endScale
        // 让用户立刻看到 startScale/endScale 的当前值，不用切换到测试爆发也能确认输入生效。
        ctx.fillStyle = '#cbe88b';
        ctx.font = `${11 * this._dpr}px 'SF Mono', Menlo, Consolas, monospace`;
        ctx.textBaseline = 'alphabetic';
        const startScale = this.curve.startScale ?? 1.0;
        const endScale = this.curve.endScale ?? 1.0;
        // 左下：起点倍率
        ctx.textAlign = 'left';
        ctx.fillText(`×${startScale.toFixed(2)}`, o0.x + 6 * this._dpr, o0.y - 6 * this._dpr);
        // 右上：终点倍率
        ctx.textAlign = 'right';
        ctx.fillText(`×${endScale.toFixed(2)}`, o1.x - 6 * this._dpr, o1.y + 14 * this._dpr);
    }
}

/**
 * 一站式工厂：把一个挂载点（容器 div）渲染成完整曲线编辑器面板
 * 包含：标题 + 启用 checkbox + Canvas + 起点/终点数字框 + 5 个预设按钮
 *
 * @param {HTMLElement} mountEl
 * @param {Object} curve
 * @param {Object} [opts]
 * @param {string} [opts.label='曲线']
 * @param {function} [opts.onChange]
 * @returns {{ refresh: function, destroy: function, editor: BezierCurveEditor }}
 */
export function buildCurvePanel(mountEl, curve, opts = {}) {
    const label = opts.label || '曲线';
    const onChange = opts.onChange || (() => {});

    // 用 label 生成一个稳定的 name 前缀（去掉非字母数字），
    // 用于给动态创建的 <input> 设置唯一 name 属性，
    // 满足浏览器 a11y/autofill 的"表单元素需要 id 或 name"建议。
    const namePrefix = 'bz_' + (label.replace(/[^A-Za-z0-9_]/g, '') || 'curve');

    mountEl.innerHTML = '';
    mountEl.classList.add('bezier-panel');

    // 标题行 + 启用复选
    const headerRow = document.createElement('div');
    headerRow.className = 'bezier-panel__header';
    const title = document.createElement('span');
    title.className = 'bezier-panel__title';
    title.textContent = label;
    const enableLabel = document.createElement('label');
    enableLabel.className = 'bezier-panel__enable';
    const enableInput = document.createElement('input');
    enableInput.type = 'checkbox';
    enableInput.name = namePrefix + '_enabled';
    enableInput.checked = curve.enabled !== false;
    enableLabel.appendChild(enableInput);
    enableLabel.appendChild(document.createTextNode('启用'));
    headerRow.appendChild(title);
    headerRow.appendChild(enableLabel);
    mountEl.appendChild(headerRow);

    // Canvas
    const canvas = document.createElement('canvas');
    canvas.className = 'bezier-panel__canvas';
    mountEl.appendChild(canvas);

    // 起点 / 终点输入
    const scaleRow = document.createElement('div');
    scaleRow.className = 'bezier-panel__scales';
    const makeScaleInput = (text, key) => {
        const wrap = document.createElement('label');
        wrap.className = 'bezier-panel__scale';
        const lbl = document.createElement('span');
        lbl.textContent = text;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.1';
        inp.className = 'panel-number';
        inp.name = namePrefix + '_' + key;
        inp.value = (curve[key] ?? 1.0).toFixed(2);
        // input/change 双绑：input 用于即时拖拽 spinner，change 在 blur 时兜底
        const commit = () => {
            const v = parseFloat(inp.value);
            if (Number.isFinite(v)) {
                curve[key] = v;
                onChange();
                if (editorRef.current) editorRef.current.draw();
            }
        };
        inp.addEventListener('input', commit);
        inp.addEventListener('change', commit);
        // 阻止 pointerdown 冒泡到 #control-panel 上的 stopPropagation
        // 虽然这里不影响 input 事件本身，但保险起见隔离一下
        inp.addEventListener('pointerdown', (e) => e.stopPropagation());
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        scaleRow.appendChild(wrap);
        return inp;
    };
    // 用 ref 包裹，避免在 makeScaleInput 闭包中引用尚未创建的 editor
    const editorRef = { current: null };
    const startInput = makeScaleInput('起点倍率', 'startScale');
    const endInput   = makeScaleInput('终点倍率', 'endScale');
    mountEl.appendChild(scaleRow);

    // 预设按钮
    const presetRow = document.createElement('div');
    presetRow.className = 'bezier-panel__presets';
    [
        ['Linear',   'linear'],
        ['EaseIn',   'easeIn'],
        ['EaseOut',  'easeOut'],
        ['Smooth',   'smooth'],
        ['Smoother', 'smoother'],
    ].forEach(([txt, key]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bezier-panel__preset';
        btn.textContent = txt;
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            editor.applyPreset(key);
        });
        presetRow.appendChild(btn);
    });
    mountEl.appendChild(presetRow);

    // 创建编辑器
    const editor = new BezierCurveEditor(canvas, curve, {
        label,
        onChange,
    });
    editorRef.current = editor;

    // 启用切换
    enableInput.addEventListener('pointerdown', (e) => e.stopPropagation());
    enableInput.addEventListener('change', () => {
        curve.enabled = enableInput.checked;
        mountEl.classList.toggle('bezier-panel--disabled', !curve.enabled);
        onChange();
    });
    if (curve.enabled === false) mountEl.classList.add('bezier-panel--disabled');

    return {
        editor,
        refresh: () => {
            enableInput.checked = curve.enabled !== false;
            startInput.value = (curve.startScale ?? 1.0).toFixed(2);
            endInput.value   = (curve.endScale ?? 1.0).toFixed(2);
            editor.refresh();
        },
        destroy: () => editor.destroy(),
    };
}
