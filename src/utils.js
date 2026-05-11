import * as THREE from 'three';

/**
 * 释放一个 Object3D 子树下的所有 GPU 资源 (geometry + material[+textures])。
 * 调用方仍负责 scene.remove(root)。本函数不会修改场景图，只 dispose 资源。
 *
 * 用法：
 *   disposeObject3D(this.mesh);
 *   Globals.scene.remove(this.mesh);
 *
 * 注意：
 *   - 共享几何/材质（同一引用被多个 mesh 用）会被多次 dispose，Three.js 内部
 *     对重复 dispose 是幂等的，所以无需去重。
 *   - 若材质上挂着 map / normalMap / 自定义 texture uniform，调用者需自行 dispose
 *     这些纹理（一般跟材质绑定的纹理我们也 dispose，避免泄漏）。
 */
export function disposeObject3D(root) {
    if (!root) return;
    root.traverse((node) => {
        if (node.geometry && typeof node.geometry.dispose === 'function') {
            node.geometry.dispose();
        }
        const mat = node.material;
        if (!mat) return;
        if (Array.isArray(mat)) {
            for (let i = 0; i < mat.length; i++) _disposeMaterial(mat[i]);
        } else {
            _disposeMaterial(mat);
        }
    });
}

function _disposeMaterial(mat) {
    if (!mat || typeof mat.dispose !== 'function') return;
    // 把材质上常见的纹理 slot 一并 dispose（这些纹理一般是该材质独有的）
    const TEXTURE_KEYS = [
        'map', 'lightMap', 'aoMap', 'emissiveMap', 'bumpMap', 'normalMap',
        'displacementMap', 'roughnessMap', 'metalnessMap', 'alphaMap',
        'envMap', 'gradientMap', 'specularMap', 'matcap'
    ];
    for (let i = 0; i < TEXTURE_KEYS.length; i++) {
        const tex = mat[TEXTURE_KEYS[i]];
        if (tex && typeof tex.dispose === 'function') tex.dispose();
    }
    mat.dispose();
}

// 全局变量容器
export const Globals = {
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    finalComposer: null,
    outlinePass: null,
    playerCreasePass: null,
    bloomPass: null,
    audioManager: null,
    player: null,
    enemies: [],
    feathers: [],
    bloodStains: [],
    recallEffects: [],
    slashEffects: [],
    spawnEffects: [],
    interruptEffects: [],
    hitSparkEffects: [],
    enemyHitBurstEffects: [],
    javelinVfxEffects: [],
    pillarBullets: [],
    obstacles: [],
    floatingTexts: [],
    // 可视地面边界（=玩家移动范围）。由 main.js 在初始化与 resize 时写入，
    // 其它模块（敌人 clamp、生成点判定等）只读使用，避免越界。
    visibleGroundBounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    targetIndicator: null,
    particleManager: null,
    uiLayer: null,
    cameraOffset: new THREE.Vector3(0, 30, 20),
    baseCamPos: new THREE.Vector3(0, 30, 20),
    baseCamTarget: new THREE.Vector3(0, 0, 0),
    clock: new THREE.Clock(),
    // 全局逻辑帧计数：每次 updateFloatingTexts 结束自增，用于"同帧合并"判定
    // （如：多把武器同帧命中同一敌人，合并为一个伤害跳字 -10 ×3贯穿）
    frameId: 0
};

import { CONFIG } from './config.js';

// ===== 伤害数字"世界尺寸"标定常量 =====
// 把跳字字号从"屏占比"改造成"世界占比"用的参考相机配置。
// 在该参数组合下，跳字屏幕字号 = 改动前完全一致（k_cam = 1）；
// 当前相机偏离这组参数（变远/变广角）时，字号按透视投影规律自动缩放，
// 视觉上等价于"跳字是世界中尺寸固定的物体"。
//
// ★ 锁死等于 arrow_preset____02.json 中已调好的镜头参数（fov=30, dist=31），
//   确保该预设下零视觉回归（k_cam ≡ 1.0，等于此改动不生效）。
// ★ 若日后整体视角风格大改且不希望靠 damageTextScale 单独补偿，再改这里。
const DMG_TEXT_REF_FOV = 30;   // 度
const DMG_TEXT_REF_DIST = 31;  // 世界单位

let shakeTimeLeft = 0;
let currentShakeIntensity = 0;

// 浏览器规定：navigator.vibrate() 在用户首次交互（pointerdown/keydown/touchstart）
// 之前调用会被拦截并打印 [Intervention] 警告。游戏可能在玩家未点击的演示模式下
// 就播放音效与触发震动（如自动 spawn / 调试场景），导致控制台被警告刷屏。
// 这里加一个一次性的"用户已交互"门：未交互前直接跳过 vibrate 调用。
let _userHasInteracted = false;
if (typeof window !== 'undefined') {
    const _markInteracted = () => {
        _userHasInteracted = true;
        window.removeEventListener('pointerdown', _markInteracted, true);
        window.removeEventListener('keydown',     _markInteracted, true);
        window.removeEventListener('touchstart',  _markInteracted, true);
    };
    window.addEventListener('pointerdown', _markInteracted, true);
    window.addEventListener('keydown',     _markInteracted, true);
    window.addEventListener('touchstart',  _markInteracted, true);
}

export function triggerHaptic(type) {
    if (!CONFIG.hapticEnabled) return;

    let duration = 0;
    let amplitude = 0;

    switch (type) {
        case 'hit':
            duration = 30;
            amplitude = 100;
            break;
        case 'recall_hit':
            duration = 40;
            amplitude = 120;
            break;
        case 'recall_hit_special':
            duration = 80;
            amplitude = 200;
            break;
        case 'die':
            duration = 60;
            amplitude = 180;
            break;
        case 'catch':
            duration = 25;
            amplitude = 60;
            break;
        default:
            return;
    }

    const finalAmplitude = Math.floor(amplitude * CONFIG.hapticIntensity);

    // iOS Safari / PWA 完全没有实现 navigator.vibrate（既不报错也不振动），属于静默禁用。
    // 这里包一层 try-catch 是为了防止个别浏览器（如旧版 iOS WebView 注入实验性 API 但抛错）打断主循环。
    if (window.AndroidNative && window.AndroidNative.vibrate) {
        try { window.AndroidNative.vibrate(duration, finalAmplitude); } catch (_) {}
    } else if (navigator.vibrate && _userHasInteracted) {
        // 未交互前调用会被浏览器拦截并产生 [Intervention] 警告 —— 静默跳过即可
        try { navigator.vibrate(duration); } catch (_) {}
    }
}

export function triggerShake(intensity, duration) {
    currentShakeIntensity = intensity;
    shakeTimeLeft = duration;
}

export function updateShake(delta) {
    if (!Globals.camera) return;

    if (shakeTimeLeft > 0) {
        shakeTimeLeft -= delta;
        Globals.camera.position.set(
            Globals.baseCamPos.x + (Math.random() - 0.5) * currentShakeIntensity,
            Globals.baseCamPos.y + (Math.random() - 0.5) * currentShakeIntensity,
            Globals.baseCamPos.z + (Math.random() - 0.5) * currentShakeIntensity
        );
    } else {
        Globals.camera.position.copy(Globals.baseCamPos);
    }

    Globals.camera.lookAt(Globals.baseCamTarget);
}

// ===== 伤害数字 · 力量迸发动效（主动攻击 / 回收命中 双组参数）=====
// 效果：从敌人正中间产生 → 极短时间冲到最远点 → 到位抖动 → 缩小淡出
// 运动由 JS 逐帧驱动（时间归一化 t ∈ [0,1]），参数全部来自 CONFIG，可在参数面板实时调整。
//
// category='attack' → 读取 dmgAtk* 前缀
// category='recall' → 读取 dmgRec* 前缀（含 high / special / 中断回收）

// 根据 category 返回参数前缀
//   'attack'  → 'dmgAtk'      （主动攻击普通命中）
//   'critAtk' → 'dmgCritAtk'  （主动攻击暴击命中；走完全独立的一组动效参数）
//   其它      → 'dmgRec'      （回收命中：含 high / special / 中断回收）
function dmgPrefix(category) {
    if (category === 'attack')  return 'dmgAtk';
    if (category === 'critAtk') return 'dmgCritAtk';
    return 'dmgRec';
}

// 按前缀读取 CONFIG，若不存在给出合理 fallback
function dmgParam(prefix, suffix, fallback) {
    const v = CONFIG[prefix + suffix];
    return v === undefined ? fallback : v;
}

// easeOutExpo：1 - 2^(-10 t)，用于"瞬间达到最远点"的猛烈曲线
function easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ===== 命中数 → 强度 t 的曲线 =====
// 输入：mergeCount（合并命中数，≥1）
// 输出：t ∈ [0, 1]，0 = 用 @1 端点，1 = 用 @max 端点；中间按曲线插值
function dmgCountStrength(mergeCount) {
    const countForMax = Math.max(1, CONFIG.dmgRecCountForMax ?? 10);
    if (mergeCount <= 1) return 0;
    if (mergeCount >= countForMax) return 1;
    const linear = (mergeCount - 1) / (countForMax - 1);
    const curveType = CONFIG.dmgRecCountCurve ?? 1;
    switch (curveType) {
        case 0: // linear
            return linear;
        case 2: // smootherstep
            return linear * linear * linear * (linear * (linear * 6 - 15) + 10);
        case 3: // easeOutQuad
            return 1 - (1 - linear) * (1 - linear);
        case 1: // smoothstep（默认）
        default:
            return linear * linear * (3 - 2 * linear);
    }
}

/**
 * 按 mergeCount 在双端点参数之间插值读取动效值。
 * 仅 'recall' 组（前缀 'dmgRec'）启用双端点；'attack' 组始终读单值。
 *
 * @param {string} prefix       'dmgRec' / 'dmgAtk'
 * @param {string} suffix       'Life' / 'ScalePunch' / ...
 * @param {number} fallback     未配置时的兜底值
 * @param {number} mergeCount   当前合并命中数（≥1）
 */
function dmgParamLerp(prefix, suffix, fallback, mergeCount) {
    const a = dmgParam(prefix, suffix, fallback);
    if (prefix !== 'dmgRec') return a; // attack 组无双端点
    const bRaw = CONFIG[prefix + suffix + 'AtMax'];
    if (bRaw === undefined) return a; // 旧配置未拆双端点 → 退化为单值
    const t = dmgCountStrength(mergeCount);
    return a + (bRaw - a) * t;
}

// 计算迸发偏移向量（按 mergeCount 在双端点之间插值得到散布范围）。
// 用于初始创建跳字以及合并时重新生成偏移。
// burstDir 为水平单位向量；hasHitDir=false 时切换到"无方向 fallback 向上"模式。
function computeBurstOffset(prefix, category, burstDir, hasHitDir, mergeCount) {
    const dMin = dmgParamLerp(prefix, 'BurstDistMin', 0.6, mergeCount);
    const dMax = dmgParamLerp(prefix, 'BurstDistMax', 1.1, mergeCount);
    const uMin = dmgParamLerp(prefix, 'BurstUpMin',   0.4, mergeCount);
    const uMax = dmgParamLerp(prefix, 'BurstUpMax',   0.9, mergeCount);
    // 无方向 fallback 上移：仅回收组有参数（双端点），主动攻击组退回 0
    const fallbackUp = category === 'recall'
        ? dmgParamLerp('dmgRec', 'FallbackUp', 1.4, mergeCount)
        : 0;
    const dist = hasHitDir ? dMin + Math.random() * Math.max(0, dMax - dMin) : 0;
    const up   = hasHitDir ? uMin + Math.random() * Math.max(0, uMax - uMin) : fallbackUp;
    return new THREE.Vector3(
        burstDir.x * dist,
        up,
        burstDir.z * dist
    );
}

// ===== 逐字进入动效辅助 =====
//
// 把已有 DOM 节点的文本拆成 <span class="dmg-char"> 单字符。
// 保留嵌套结构（如 <span class="dmg-pen">X3贯穿</span>）—— 只把每个 TextNode 内的字符拆出来，
// 嵌套 span 的样式/类名不动，仍然作用在每个字符上。
// 返回拆出的字符 span 数组（按文档顺序，含外层和内层 .dmg-pen 中的字符）。
function splitFloatingTextChars(rootEl) {
    const chars = [];
    const visit = (node) => {
        const childNodes = Array.from(node.childNodes);
        for (const child of childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.nodeValue || '';
                if (!text) {
                    node.removeChild(child);
                    continue;
                }
                const frag = document.createDocumentFragment();
                // Array.from 处理 surrogate pair，避免拆坏组合字符
                for (const ch of Array.from(text)) {
                    if (ch === ' ' || ch === '\t' || ch === '\n') {
                        frag.appendChild(document.createTextNode(ch));
                        continue;
                    }
                    const span = document.createElement('span');
                    span.className = 'dmg-char';
                    span.textContent = ch;
                    // 让 transform/scale 生效需要 inline-block；提前 inline 一次避免 CSS 缺失时整字消失
                    span.style.display = 'inline-block';
                    span.style.transformOrigin = '50% 50%';
                    span.style.willChange = 'transform';
                    frag.appendChild(span);
                    chars.push(span);
                }
                node.replaceChild(frag, child);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                visit(child);
            }
        }
    };
    visit(rootEl);
    return chars;
}

// 给 entry 重新拆字（合并 / 内容变更后调用）。
// 设计：未到 delay 的字符 scale=0（占位但不可见）；到 delay 后字符以 peakᵢ 大小"从天而降"，
// 在 durᵢ 内 easeOutCubic 衰减到 1，之后稳定在 1。
// charStartAge = entry.age 让节奏从"现在"开始算。
function rebuildFloatingChars(entry) {
    if (!entry || !entry.element) return;
    entry.charSpans = splitFloatingTextChars(entry.element);
    entry.charStartAge = entry.age;
    // 初值 scale=0：所有字符占位但不可见，等候各自的 delay
    // dmgRec / dmgAtk 都支持逐字跳字；其它分组（若有）维持 scale(1) 不动。
    const prefix = entry.paramPrefix;
    const supported = (prefix === 'dmgRec' || prefix === 'dmgAtk');
    if (supported && isCharStaggerEnabled(prefix)) {
        for (const sp of entry.charSpans) {
            sp.style.transform = 'scale(0)';
        }
    } else {
        for (const sp of entry.charSpans) {
            sp.style.transform = 'scale(1)';
        }
    }
}

// 兼容 true/false 与面板滑块写入的 0/1 两种存储方式
// prefix: 'dmgRec' | 'dmgAtk' | 'dmgCritAtk' —— 对应不同的开关键
function isCharStaggerEnabled(prefix = 'dmgRec') {
    const key = prefix + 'CharStaggerEnabled'; // dmgRec/dmgAtk/dmgCritAtk 同名结构
    const v = CONFIG[key];
    if (v === false || v === 0 || v === '0') return false;
    return true;
}

// 每帧根据 age 更新每个字符 span 的 scale。dmgRec / dmgAtk 两组共用同款逻辑，
// 各自读取自己分组下的 Char* 参数；其它分组（若将来有）直接跳过。
//
// "从天而降"模型（v3）：
//   字符 i 按累加 delay 顺序出现；出现瞬间 scale = peakᵢ（由大），
//   随后在 durᵢ 内 easeOutCubic 衰减到 1，之后稳定。未到 delay 时 scale=0（占位不可见）。
//
//   - delayᵢ = Σ(j<i) gapⱼ ；gapⱼ 从 GapStart 线性插值到 GapEnd（前小后大 = 前快后慢出现）
//   - durᵢ   从 DurStart  线性插值到 DurEnd  （前快落地，后慢落地）
//   - peakᵢ  从 PeakStart 线性插值到 PeakEnd （前面字出现得小，后面字出现得大）
//
// easeOutCubic：1 - (1-p)³ —— 前期快速接近终点，后期缓慢吸入，"从天而降"重量感
function updateFloatingChars(entry) {
    if (!entry || !entry.charSpans || entry.charSpans.length === 0) return;
    const prefix = entry.paramPrefix;
    if (prefix !== 'dmgRec' && prefix !== 'dmgAtk' && prefix !== 'dmgCritAtk') return;
    if (!isCharStaggerEnabled(prefix)) {
        for (const sp of entry.charSpans) {
            if (sp.style.transform !== 'scale(1)') sp.style.transform = 'scale(1)';
        }
        return;
    }

    const N = entry.charSpans.length;
    const localAge = entry.age - (entry.charStartAge || 0);

    // 双端点参数：i = 0 → Start，i = N-1 → End
    // 各分组各读各的 Char* 键（dmgRec / dmgAtk 同名结构）
    const gapStart  = Math.max(0,     CONFIG[`${prefix}CharGapStart`]  ?? 0.04);
    const gapEnd    = Math.max(0,     CONFIG[`${prefix}CharGapEnd`]    ?? 0.10);
    const durStart  = Math.max(0.001, CONFIG[`${prefix}CharDurStart`]  ?? 0.18);
    const durEnd    = Math.max(0.001, CONFIG[`${prefix}CharDurEnd`]    ?? 0.40);
    const peakStart = CONFIG[`${prefix}CharPeakStart`] ?? 1.4;
    const peakEnd   = CONFIG[`${prefix}CharPeakEnd`]   ?? 2.4;

    // 字符 i 的归一化进度 lerpFrac（0..1）：N=1 时全部用 Start
    const lerpFrac = (i) => (N <= 1 ? 0 : i / (N - 1));

    // 累加 delay：delay[i] = Σ_{j<i} gap[j]，其中 gap[j] 在 j=0..N-1 的 lerpFrac 上插值
    let delay = 0;
    for (let i = 0; i < N; i++) {
        const span = entry.charSpans[i];
        const f = lerpFrac(i);
        const dur  = durStart  + (durEnd  - durStart)  * f;
        const peak = peakStart + (peakEnd - peakStart) * f;

        let s;
        if (localAge < delay) {
            s = 0;                                  // 还没轮到，占位不可见
        } else if (localAge >= delay + dur) {
            s = 1;                                  // 已落定
        } else {
            const p = (localAge - delay) / dur;     // 0..1
            // easeOutCubic：1 - (1-p)^3，p=0 → 0；p=1 → 1
            const ease = 1 - Math.pow(1 - p, 3);
            // scale 从 peak 线性插值衰减到 1，曲线由 ease 控制
            s = peak + (1 - peak) * ease;
        }
        span.style.transform = `scale(${s.toFixed(4)})`;

        // 推进到下一个字符的 delay：用当前 i 的 gap
        delay += gapStart + (gapEnd - gapStart) * f;
    }
}

// 归一化阶段比例（保证三段之和为 1，防止面板滑出 > 1 的总和导致最后阶段被吞）
function getDmgStageRatios(prefix, mergeCount = 1) {
    // 'MoveTimeRatio' = 跳字从生成到抵达最远点这段移动过程占总寿命的比例
    // （旧名 'BurstRatio'，已通过 migrateDamageTextConfig 平滑改名）
    let burst = Math.max(0.001, dmgParamLerp(prefix, 'MoveTimeRatio', 0.12, mergeCount));
    let hold  = Math.max(0,     dmgParamLerp(prefix, 'HoldRatio',  0.55, mergeCount));
    let fade  = Math.max(0.001, dmgParamLerp(prefix, 'FadeRatio',  0.33, mergeCount));
    const sum = burst + hold + fade;
    if (sum > 1.0) { // 按比例缩放回 1
        burst /= sum; hold /= sum; fade /= sum;
    }
    return { burst, hold, fade };
}

/**
 * 显示浮动伤害/战斗文本。
 * @param {THREE.Vector3} position  世界坐标（敌人/受击对象位置）
 * @param {string} text             HTML 文本
 * @param {string} cssClass         CSS 类名（text-low / text-high / text-crit / text-interrupt）
 * @param {THREE.Vector3} [hitDir]  攻击前进方向。用于决定迸发方向；不传则随机水平散射。
 * @param {'attack'|'recall'} [category]  伤害来源分类，决定读取哪一组参数；默认 'recall'。
 */
export function showFloatingText(position, text, cssClass, hitDir = null, category = 'recall') {
    if (!CONFIG.showCombatTexts) return null;
    if (!Globals.uiLayer || !Globals.camera) return null;

    const w = document.getElementById('game-wrapper');
    if (!w) return null;

    // 确定参数前缀（本次数字属于哪组）
    const prefix = dmgPrefix(category);

    // 起始世界坐标：敌人正中间（从传入 position 直接开始，不再偏上也不做位置扰动）
    const originPos = position.clone();

    // --- 迸发方向（水平）---
    const burstDir = new THREE.Vector3();
    const hasHitDir = hitDir && (hitDir.x !== 0 || hitDir.y !== 0 || hitDir.z !== 0);
    if (hasHitDir) {
        // 顺着攻击方向"被打出来"，加一点角度扰动避免完全一直线
        burstDir.set(hitDir.x, 0, hitDir.z);
        if (burstDir.lengthSq() < 1e-6) burstDir.set(0, 0, 1);
        burstDir.normalize();
        // ± 随机偏角（度，来自参数面板）
        const jitterDeg = dmgParam(prefix, 'DirJitterDeg', 40);
        const jitterAngle = (Math.random() - 0.5) * (Math.PI / 180) * jitterDeg;
        const cosA = Math.cos(jitterAngle), sinA = Math.sin(jitterAngle);
        const jx = burstDir.x * cosA - burstDir.z * sinA;
        const jz = burstDir.x * sinA + burstDir.z * cosA;
        burstDir.set(jx, 0, jz);
    } else {
        // 无方向：水平几乎不动，纯向上迸发（用于"中断回收"等信息性提示）
        burstDir.set(0, 0, 0);
    }

    // 迸发终点位移向量。初始按 mergeCount=1 计算（@1 端点）；
    // 后续若发生合并，showRecallDamageText 会重写 burstOffset 以反映 @max 端点。
    const burstOffset = computeBurstOffset(prefix, category, burstDir, hasHitDir, 1);

    // --- 创建 DOM ---
    const div = document.createElement('div');
    div.className = `floating-text ${cssClass}`;
    div.innerHTML = text;
    // 初始隐藏，避免 append 后到首帧 update 之间出现"全尺寸未缩放字"闪一下
    div.style.opacity = '0';
    Globals.uiLayer.appendChild(div);

    // 读取 CSS 计算出的基础字号（受 .text-low/.text-high/... + --dmg-scale 控制）
    // 此时未覆盖 fontSize，getComputedStyle 可以直接拿到规则里的值
    const baseFontSizePx = parseFloat(getComputedStyle(div).fontSize) || 12;
    // 先把字号置 0，由首帧 update 立即赋予正确值
    div.style.fontSize = '0px';

    // 立即计算初始屏幕位置（避免首帧 0,0 闪现）
    const shakenPos = Globals.camera.position.clone();
    const shakenQuat = Globals.camera.quaternion.clone();
    Globals.camera.position.copy(Globals.baseCamPos);
    Globals.camera.lookAt(Globals.baseCamTarget);
    Globals.camera.updateMatrixWorld();

    const v = originPos.clone();
    v.project(Globals.camera);
    div.style.left = `${Math.round((v.x * 0.5 + 0.5) * w.clientWidth)}px`;
    div.style.top  = `${Math.round((v.y * -0.5 + 0.5) * w.clientHeight)}px`;

    Globals.camera.position.copy(shakenPos);
    Globals.camera.quaternion.copy(shakenQuat);
    Globals.camera.updateMatrixWorld();

    const entry = {
        // 基础位置 & 偏移目标
        originPos,
        burstOffset,
        // 每帧实际使用的世界坐标（由 origin + burstOffset*进度 计算）
        worldPos: originPos.clone(),
        element: div,
        // 基础字号（对应 scale = 1）
        baseFontSizePx,
        // 参数组前缀（整个生命周期内固定，避免运行时切换）
        paramPrefix: prefix,
        // 是否带攻击方向（决定散布逻辑）—— 合并重算 burstOffset 时仍需要
        hasHitDir,
        // 创建时的水平迸发方向（合并时复用，保持迸发轨迹一致）
        burstDir: burstDir.clone(),
        // 时间
        age: 0,
        // 寿命：每帧根据 mergeCount 实时插值；这里只存初始值供回退/容错使用
        life: Math.max(0.05, dmgParamLerp(prefix, 'Life', 0.75, 1)),
        // 同帧合并次数（≥1）。recall 类合并时由 showRecallDamageText 增加。
        mergeCount: 1,
        // 创建时所在的逻辑帧 ID（用于同帧合并判定）
        frameId: Globals.frameId,
        // 创建时刻（毫秒，performance.now()）—— 与 frameId 配合做"同帧 OR 时间窗口"合并判定
        createdAt: performance.now(),
        // 标记是否已被回收清理（用于外部合并逻辑判断引用是否仍有效）
        alive: true,
        // 逐字进入动效用：拆出来的字符 span 数组 + 字符动画的"参考起点 age"
        // （合并时整条文本重置重播，会刷新这两项）
        charSpans: [],
        charStartAge: 0,
    };
    // 拆字（dmgRec 与 dmgAtk 两组都参与逐字跳字动画；各自读各自分组下的 Char* 参数）
    rebuildFloatingChars(entry);
    Globals.floatingTexts.push(entry);
    return entry;
}

/**
 * 更新一个已存在的浮动文本的 HTML 内容（用于"同帧合并多把武器命中"等场景）。
 * 在不重置生命周期的前提下原地改字，避免重复创建/销毁 DOM。
 *
 * @param {object} entry  showFloatingText 返回的引用
 * @param {string} html   新的 HTML 内容
 */
export function updateFloatingTextContent(entry, html) {
    if (!entry || !entry.alive || !entry.element) return;
    entry.element.innerHTML = html;
    // 内容变更 → 重新拆字 + 重置逐字动画起点（整条重播）
    rebuildFloatingChars(entry);
}

/**
 * 显示"回收命中"伤害数字，自动处理同帧多把武器命中的合并显示。
 *
 * 行为：
 *   - 第一次命中（或上一条已离开当前帧）→ 创建跳字 "-amount"
 *   - 同帧再次命中同一目标 → 不新建 DOM，把已有跳字内容更新为
 *       "-amount ×N贯穿"（N = 累计命中数）
 *   - low 类型（主动攻击飞行穿刺）不参与合并，每次独立跳字
 *   - low + isCrit（主动攻击暴击）也不合并；走 'critAtk' 分组（dmgCritAtk* 参数），
 *     CSS 类切换到 .text-crit（亮黄、26px 基础字号）
 *
 * 把"合并状态"绑定在 target 自身的 _recallTextMerge 字段上，与目标共生共死。
 *
 * @param {object} target  受击目标实例（Enemy / PillarEnemy / WoodenStake）
 * @param {THREE.Vector3} position
 * @param {number} amount
 * @param {'low'|'high'|'special'} type
 * @param {THREE.Vector3} direction
 * @param {boolean} [isCrit]  仅在 type==='low' 时有意义；true 则路由到暴击分组与样式
 */
export function showRecallDamageText(target, position, amount, type, direction, isCrit = false) {
    // 主动攻击暴击：与"普通主动攻击"在 CSS / 动效分组上完全分离
    //   - 字号 + 描边沿用 .text-crit（26px 基础字号）
    //   - 颜色额外叠加 .text-recall-max（亮燃红 #ff7a4a）覆盖 .text-crit 的暖黄
    //     —— 这样视觉上与"满贯穿回收命中"是同一档亮红色，强调"最爆发"的含义
    const lowCss = (type === 'low' && isCrit) ? 'text-crit text-recall-max' : 'text-low';
    const cssClass = type === 'low' ? lowCss : (type === 'special' ? 'text-crit' : 'text-high');
    const category = type === 'low'
        ? (isCrit ? 'critAtk' : 'attack')
        : 'recall';

    // low（主动攻击；含暴击）不合并：每次独立跳字
    if (type === 'low') {
        showFloatingText(position, `-${amount}`, cssClass, direction, category);
        return;
    }

    // 回收命中跳字按"贯穿数"分阶段着色（覆盖 .text-high / .text-crit 的 color）：
    //   1 把武器命中（未贯穿）        → text-recall-solo   白
    //   ≥2 但未达 dmgRecCountForMax  → text-recall-pierce 黄
    //   ≥ dmgRecCountForMax          → text-recall-max    红
    // 类的字号 / 描边 / 字符动效仍由 high / crit 控制，这里只决定颜色。
    const RECALL_TIER_CLASSES = ['text-recall-solo', 'text-recall-pierce', 'text-recall-max'];
    const recallTierClassFor = (count) => {
        const max = Math.max(1, CONFIG.dmgRecCountForMax ?? 10);
        if (count <= 1) return 'text-recall-solo';
        if (count >= max) return 'text-recall-max';
        return 'text-recall-pierce';
    };
    const applyRecallTierClass = (entry, count) => {
        if (!entry || !entry.element) return;
        const want = recallTierClassFor(count);
        const el = entry.element;
        for (const cls of RECALL_TIER_CLASSES) {
            if (cls !== want && el.classList.contains(cls)) el.classList.remove(cls);
        }
        if (!el.classList.contains(want)) el.classList.add(want);
    };

    // recall：尝试与"上一次命中"合并。判定条件 = 同一逻辑帧 OR 时间窗口内
    // （时间窗口由 CONFIG.dmgRecMergeWindow 控制，单位秒；0 表示仅同帧合并）
    const m = target._recallTextMerge;
    let canMerge = false;
    if (m && m.entry && m.entry.alive) {
        if (m.entry.frameId === Globals.frameId) {
            canMerge = true;
        } else {
            const winSec = Math.max(0, CONFIG.dmgRecMergeWindow ?? 0);
            if (winSec > 0 && (performance.now() - m.entry.createdAt) <= winSec * 1000) {
                canMerge = true;
            }
        }
    }
    if (canMerge) {
        m.count += 1;
        // 合并后样式：第二次命中"升级"成 special 视觉（更亮更大），强化"贯穿"反馈
        // 但若本次或之前命中里已有 special，保持 special；否则保持 high
        if (type === 'special') m.type = 'special';
        // 同帧多次命中一律按"贯穿"格式显示，伤害值取最新一次（与设计一致：单次伤害 × 命中数）
        m.amount = amount;
        // 用大写 X 而非 Unicode '×' (U+00D7) 或小写 x：
        //   - '×' 在多数字体里字面中心偏下，水平对齐时显得"沉底"
        //   - 小写 x 只占 x-height（字体下半段），同样偏低
        //   - 大写 X 占满 cap-height，几何中心最接近行中点，与数字高度一致
        const html = `-${m.amount}<span class="dmg-pen">X${m.count}贯穿</span>`;
        updateFloatingTextContent(m.entry, html);
        // 按当前贯穿数切换颜色阶段（白 → 黄 → 红）
        applyRecallTierClass(m.entry, m.count);

        // 用新的 mergeCount 同步刷新 entry 的"会随命中数变化"的物理量：
        //   1) burstOffset：让额外冲程立刻生效（原偏移可能已经走完）
        //   2) life：直接换上新寿命；如果 age 已超过新寿命的尾段，回拉到 hold 中点 "复活"
        const e = m.entry;
        e.mergeCount = m.count;
        const newOffset = computeBurstOffset(e.paramPrefix, 'recall', e.burstDir, e.hasHitDir, m.count);
        e.burstOffset.copy(newOffset);
        const newLife = Math.max(0.05, dmgParamLerp(e.paramPrefix, 'Life', 0.75, m.count));
        const ratios = getDmgStageRatios(e.paramPrefix, m.count);
        e.life = newLife;
        // 防止合并瞬间 t 已经进入淡出末段或之外 —— 把 age 拉回到驻留段中点，让贯穿增益肉眼可见
        const tAfter = e.age / e.life;
        if (tAfter >= ratios.burst + ratios.hold) {
            e.age = newLife * (ratios.burst + ratios.hold * 0.5);
        }
        return;
    }

    // 新建一个 entry 并记录合并状态
    const entry = showFloatingText(position, `-${amount}`, cssClass, direction, category);
    if (!entry) return;
    // 首次命中（count = 1，未贯穿）→ 白色
    applyRecallTierClass(entry, 1);
    target._recallTextMerge = {
        entry,
        count: 1,
        amount,
        type,
    };
}

export function updateFloatingTexts(delta) {
    if (!Globals.camera) return;
    const w = document.getElementById('game-wrapper');
    if (!w) return;

    // 限制单帧 delta，防止切后台回来后出错
    const dt = Math.min(delta, 1 / 30);

    // 保存可能带有震动偏移的相机状态
    const shakenPos = Globals.camera.position.clone();
    const shakenQuat = Globals.camera.quaternion.clone();

    // 临时重置相机到无震动状态以获得稳定投影
    Globals.camera.position.copy(Globals.baseCamPos);
    Globals.camera.lookAt(Globals.baseCamTarget);
    Globals.camera.updateMatrixWorld();

    for (let i = Globals.floatingTexts.length - 1; i >= 0; i--) {
        const txt = Globals.floatingTexts[i];
        txt.age += dt;
        const t = txt.age / txt.life; // 0..1 的归一化时间

        // 按该数字所属组（attack / recall）读取参数。
        // recall 组每帧根据 txt.mergeCount 在双端点之间插值；attack 组等价于读单值。
        const prefix = txt.paramPrefix || 'dmgRec';
        const mc = txt.mergeCount || 1;
        const ratios = getDmgStageRatios(prefix, mc);
        const burstEnd = ratios.burst;
        const holdEnd  = ratios.burst + ratios.hold;
        const fadeEnd  = holdEnd + ratios.fade; // ≤ 1；超过 fadeEnd 的时间直接判定结束
        const scaleStart = dmgParamLerp(prefix, 'ScaleStart', 0.0, mc);
        const scalePunch = dmgParamLerp(prefix, 'ScalePunch', 1.7, mc);
        const scaleHold  = dmgParamLerp(prefix, 'ScaleHold',  1.0, mc);
        const scaleEnd   = dmgParamLerp(prefix, 'ScaleEnd',   0.6, mc);
        // 摇摆角度三点过渡：Start → Mid → End，与跳字生命周期严格对齐：
        //   阶段 A（burst，"出现"段）：Start → Mid，应用 ShakeAppearCurve（ease-out，先快后慢）
        //   阶段 B（hold，"驻留"段）：保持 Mid 不动
        //   阶段 C（fade，"消失"段）：Mid → End，应用 ShakeEndCurve（ease-in，先慢后急）
        // ShakeAmpMid 缺省时取 (Start + End) / 2，等同两点线性插值，兼容老配置。
        const shakeAmp0  = dmgParamLerp(prefix, 'ShakeAmpStart', 4.0, mc);
        const shakeAmp2  = dmgParamLerp(prefix, 'ShakeAmpEnd',   0.0, mc);
        const shakeAmp1  = dmgParamLerp(prefix, 'ShakeAmpMid',   (shakeAmp0 + shakeAmp2) / 2, mc);
        // 出现段曲线指数（>=1）：1 - pow(1-p, curve)，越大开头甩得越急、后段越缓
        const shakeAppearCurve = Math.max(1, dmgParamLerp(prefix, 'ShakeAppearCurve', 3.0, mc));
        // 消失段曲线指数（>=1）：pow(p, curve)，越大前段越缓、收尾越急
        const shakeEndCurve = Math.max(1, dmgParamLerp(prefix, 'ShakeEndCurve', 3.0, mc));

        // 超过三段总占比（burst + hold + fade）即视为结束，这样"缩小淡出占比"可以严格
        // 对应实际淡出时长；否则残余占比会被强行拉长淡出段，导致你调低 fadeRatio 也看不出变化。
        if (t >= fadeEnd || t >= 1) {
            if (txt.element.parentNode) txt.element.parentNode.removeChild(txt.element);
            txt.alive = false;
            Globals.floatingTexts.splice(i, 1);
            continue;
        }

        // ---- 计算位移进度 / 缩放 / 抖动 / 透明度 ----
        let travel;          // 0..1，沿迸发偏移方向走完的比例
        let scale;           // 当前缩放
        let opacity = 1;     // 当前透明度
        let shakePx = 0;     // 屏幕空间抖动振幅（像素）

        if (t <= burstEnd) {
            // 阶段 A：移动段 —— 瞬间冲到最远点（强 ease-out）
            // 缩放从 scaleStart 渐变到 scalePunch（与位移同曲线）：
            //   - scaleStart = 0 → 经典"从一点弹出"
            //   - scaleStart > 0 → 生成时已具尺寸，再继续放大冲到 punch
            const p = t / burstEnd;                  // 0..1
            travel = easeOutExpo(p);
            scale = scaleStart + (scalePunch - scaleStart) * travel;
        } else if (t <= holdEnd) {
            // 阶段 B：抵达最远点后驻留
            const holdSpan = Math.max(1e-4, holdEnd - burstEnd);
            const p = (t - burstEnd) / holdSpan; // 0..1
            travel = 1.0;
            // 缩放：punch → hold（前 30% 回弹）
            const squashP = Math.min(1, p / 0.3);
            scale = scalePunch + (scaleHold - scalePunch) * squashP;
        } else {
            // 阶段 C：缩小淡出（时长严格等于 fadeRatio * life）
            const fadeSpan = Math.max(1e-4, ratios.fade);
            const p = Math.min(1, (t - holdEnd) / fadeSpan); // 0..1
            travel = 1.0;
            scale = scaleHold + (scaleEnd - scaleHold) * p;
            opacity = 1 - p;
        }

        // 摇摆角度：与跳字三段生命周期（burst / hold / fade）严格对齐
        //   阶段 A "出现"  ：Start → Mid，ease-out（1 - pow(1-p, ShakeAppearCurve)），先快后慢
        //   阶段 B "驻留"  ：保持 Mid 不变
        //   阶段 C "消失"  ：Mid → End，ease-in（pow(p, ShakeEndCurve)），先慢后急
        if (t <= burstEnd) {
            const p = t / Math.max(1e-4, burstEnd);
            const pCurved = 1 - Math.pow(1 - p, shakeAppearCurve);
            shakePx = shakeAmp0 + (shakeAmp1 - shakeAmp0) * pCurved;
        } else if (t <= holdEnd) {
            shakePx = shakeAmp1;
        } else {
            const fadeSpan = Math.max(1e-4, ratios.fade);
            const p = Math.min(1, (t - holdEnd) / fadeSpan);
            const pCurved = Math.pow(p, shakeEndCurve);
            shakePx = shakeAmp1 + (shakeAmp2 - shakeAmp1) * pCurved;
        }

        // 世界坐标 = 原点 + 偏移 * 进度
        txt.worldPos.copy(txt.originPos).addScaledVector(txt.burstOffset, travel);

        // 投影
        const v = txt.worldPos.clone();
        v.project(Globals.camera);

        if (v.z > 1.0) {
            txt.element.style.display = 'none';
            continue;
        }
        txt.element.style.display = '';

        const screenX = (v.x *  0.5 + 0.5) * w.clientWidth;
        const screenY = (v.y * -0.5 + 0.5) * w.clientHeight;

        // 一次性旋转过渡（绕 z 轴左右倾斜：左上右下 ↔ 右上左下）。
        // shakePx 已在上方完成 Start → Mid → End 三点插值（叠加 ShakeEndCurve 曲线），
        // 单位为度（deg），可正可负 —— 符号决定倾斜方向。
        const rotDeg = shakePx;

        // 取整到整数像素，避免亚像素定位导致的字体双线性过采样模糊
        txt.element.style.left = `${Math.round(screenX)}px`;
        txt.element.style.top  = `${Math.round(screenY)}px`;

        // === 世界尺寸适配：根据相机当前 fov / dist 算修正系数 k_cam ===
        // 透视：k_cam = (REF 半视高) / (当前 半视高)，半视高 = tan(fov/2) × depth
        // 正交：k_cam = REF 半视高 / 当前 半视高（半视高 = (top-bottom)/2）
        // 在参考配置下 k_cam = 1.0，与改动前像素级一致；
        // 镜头拉远/广角 → k_cam < 1 → 字按透视规律变小（"世界比例"行为）。
        let kCam = 1.0;
        const cam = Globals.camera;
        const halfHRef = Math.tan(THREE.MathUtils.degToRad(DMG_TEXT_REF_FOV) / 2) * DMG_TEXT_REF_DIST;
        if (cam.isPerspectiveCamera) {
            // 用稳定基相机位置（baseCamPos）算深度，避开震动抖动；
            // 每个跳字独立按其世界位置算，远近敌人字号自然不同。
            const depthNow = txt.worldPos.distanceTo(Globals.baseCamPos);
            const halfHNow = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * Math.max(0.001, depthNow);
            kCam = halfHRef / halfHNow;
        } else if (cam.isOrthographicCamera) {
            const halfHNow = (cam.top - cam.bottom) * 0.5;
            kCam = halfHRef / Math.max(0.001, halfHNow);
        }

        // 字号用矢量缩放替代 transform scale —— 字体始终清晰无锯齿
        const fontPx = Math.max(0, txt.baseFontSizePx * scale * kCam);
        txt.element.style.fontSize = `${fontPx.toFixed(2)}px`;
        // transform：锚点 + 旋转（定位在 CSS 里已有 translate3d，为避免覆盖此处写全）
        txt.element.style.transform = `translate3d(-50%, -50%, 0) rotate(${rotDeg.toFixed(2)}deg)`;
        txt.element.style.opacity = opacity.toFixed(3);

        // 逐字进入动效：每帧根据 age 更新各字符 span 的 scale（独立于外层缩放/旋转）
        updateFloatingChars(txt);
    }

    // 恢复相机震动状态
    Globals.camera.position.copy(shakenPos);
    Globals.camera.quaternion.copy(shakenQuat);
    Globals.camera.updateMatrixWorld();

    // 帧推进：本帧所有命中调用都已发生在 frameId 当前值上，下一逻辑帧 ++
    // 这样"同帧合并"判定能在每帧之间清晰切片
    Globals.frameId++;
}

export function getClosestEnemy() {
    let closest = null, minDist = Infinity;
    Globals.enemies.forEach(e => { 
        if (e.isDead) return; 
        const d = Globals.player.mesh.position.distanceTo(e.mesh.position); 
        if (d < minDist) { minDist = d; closest = e; } 
    });
    return closest;
}
