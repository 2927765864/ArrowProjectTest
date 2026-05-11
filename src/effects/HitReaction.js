import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * HitReaction - 敌人受击反馈（闪白 + Squash & Stretch 弹性形变 + Bend 击退弯曲）
 *
 * 核心模型："Squash & Stretch"（迪士尼经典动画 12 法则之首）：
 *   命中瞬间，敌人沿命中方向被"压扁"（squash），同时垂直方向"鼓起"（bulge）；
 *   弹簧欠阻尼过冲到反向时，敌人沿命中方向"拉长"（stretch），同时垂直方向"收缩"（pinch）；
 *   最后若干次余振衰减回原始。两阶段由同一个有符号弹簧位移 s(t) 自然衔接，无需人工切换。
 *
 * 第二通道："Bend / Follow-Through"（被击退时的方向性弯曲，配合击退冲击感）：
 *   纯 S&S 是沿命中轴对称的，没有"被推"的方向性。
 *   Bend 通道由 applyKnockback(force) 单独触发：注入一个独立弹簧 _bendX(t)，
 *   用一个垂直命中轴的"推动方向" bendDir 给顶点加偏移：
 *     · 二次弯曲分量：远端 |t|→1 处偏移最大，命中点 t→0 处偏移小 → "中间被推、上下两端因惯性滞后"
 *     · 线性剪切分量：整体被推一下
 *     · 命中处推入分量：命中那一面相对身体陷进去
 *   这样配合击退位移，外观呈现"敌人被打弯了、然后回弹"的果冻反应。
 *
 *   弹簧方程: ẍ = -k*x - c*ẋ
 *     k = hitDeformStiffness, c = hitDeformDamping
 *     初始条件: x(0)=1（归一化峰值挤压），v(0)=0
 *     默认 k=260, c=6 → 阻尼比 ζ ≈ 0.19, 自然频率 ω ≈ 16 rad/s
 *     行为：x 从 +1 衰减过零到 ≈-0.55（明显过冲），再反弹到 +0.18，最后归零（约 0.5s）
 *
 * 形变映射（命中轴 axis = 单位向量在 deformTarget 局部空间）:
 *   令 sPos = max(s, 0)，sNeg = max(-s, 0)
 *
 *   沿命中轴方向的位置缩放：
 *     factorAxis = 1 - sPos*squashAxis + sNeg*stretchAxis
 *     squash 阶段沿轴变短；stretch 阶段沿轴拉长
 *
 *   垂直命中轴方向的位置缩放：
 *     factorPerp = 1 + sPos*squashBulge - sNeg*stretchPinch
 *     squash 阶段垂直胀大；stretch 阶段垂直收缩
 *
 *   这两段是同一个弹簧位移的不同符号区域驱动，所以衔接自然，会出现压→拉→轻微反压→稳定。
 *
 * Shader 实现（球形/柱状敌人）：
 *   把每个顶点 P 分解为沿轴分量 Pa = dot(P, axis)*axis 和垂直分量 Pp = P - Pa
 *   变形后 P' = Pa*factorAxis + Pp*factorPerp
 *   再叠加一个高斯局部凹陷（dent）作为"打击点"细节（正向 s 时叠加，stretch 阶段消失）。
 *
 * 模式开关：
 *   构造时传入 { flashOnly: true } 表示"只用闪白通道，不参与形变弹簧"。木桩用此模式——
 *   它的 squash & stretch 由 WoodenStake 自己跑独立弹簧（读 stakeDeform* 参数），
 *   形变 shader uniforms 不会被驱动（始终为 0）。这样木桩只继承闪白手感，形变完全独立调参。
 *
 * 触发：trigger(hitPointWorld, hitDirWorld)
 * 更新：update(delta)
 */
export class HitReaction {
    constructor(options = {}) {
        // 模式：true = 只走闪白通道（木桩用），false = 完整启用闪白+形变（球形/柱状用）
        this._flashOnly = !!options.flashOnly;

        // ---------- 闪白 ----------
        this._flashUniform = { value: 0.0 };
        this._flashColorUniform = { value: new THREE.Color(0xffffff) };
        this._flashTime = 0;
        this._flashDuration = 0.0;
        this._flashPeak = 0.0;

        // ---------- 形变 uniforms ----------
        // 命中点：deformTarget 局部空间下的坐标（顶点同一空间）
        this._hitCenterUniform = { value: new THREE.Vector3(0, 0, 0) };
        // 命中轴：deformTarget 局部空间下的单位向量
        this._hitAxisUniform   = { value: new THREE.Vector3(0, 0, 1) };
        // 弹簧位移（有符号；+ = squash 压扁阶段，- = stretch 拉长阶段；归一化幅度 ~[-0.6, 1.0]）
        this._springUniform    = { value: 0.0 };
        // 局部凹陷参数
        this._dentDepthUniform = { value: 0.0 };
        this._dentRadiusUniform = { value: 0.7 };
        // squash & stretch 幅度参数（每帧从 CONFIG 同步，方便面板调参立即生效）
        this._squashAxisUniform   = { value: 0.5 };
        this._squashBulgeUniform  = { value: 0.5 };
        this._stretchAxisUniform  = { value: 0.6 };
        this._stretchPinchUniform = { value: 0.3 };

        // ---------- Bend（击退弯曲）通道 ----------
        // 弯曲位移（有符号；弹簧值，> 0 时正向弯，回弹过程会过零）
        this._bendUniform        = { value: 0.0 };
        // 弯曲方向（deformTarget 局部空间下的单位向量；= 击退方向的水平投影，不与 hitAxis 正交化）
        this._bendDirUniform     = { value: new THREE.Vector3(1, 0, 0) };
        // 弯曲幅度参数（运行时从 CONFIG 同步）
        // bulge      = (1-t²) 钟形位移幅度（"中间凸出，两端滞后"的主分量；正面命中主导）
        // curvature  = sign(t)*t² 二次弯曲幅度（C 形弯曲，侧击主导）
        // shear      = t 线性剪切幅度（通用副分量）
        // pushIn     = -(1-t²) 命中处反凹（命中那一面相对凹下去）
        this._bendBulgeUniform     = { value: 0.35 };
        this._bendCurvatureUniform = { value: 0.55 };
        this._bendShearUniform     = { value: 0.30 };
        this._bendPushInUniform    = { value: 0.18 };
        this._bendAxisLenUniform   = { value: 0.5 };

        // 弹簧状态
        this._springX = 0;
        this._springV = 0;
        this._deformTime = 0;
        this._deformActive = false;

        // Bend 弹簧状态（独立于 squash 弹簧）
        this._bendX = 0;
        this._bendV = 0;
        this._bendTime = 0;
        this._bendActive = false;

        this._materials = [];
        this._rootMesh = null;
        this._deformTarget = null;
        this._tmpV1 = new THREE.Vector3();
        this._tmpV2 = new THREE.Vector3();
        this._tmpQ  = new THREE.Quaternion();
    }

    /**
     * 绑定命中位置/方向的参考坐标系。
     * rootMesh: 世界坐标转换基准（即 Enemy.mesh 根 Group）
     * deformTarget: 具体被形变的 Mesh（如 Enemy.bodyMesh）。
     */
    setTargets(rootMesh, deformTarget) {
        this._rootMesh = rootMesh;
        this._deformTarget = deformTarget;
    }

    /**
     * 把受击效果注入一个 MeshBasicMaterial。
     * 之后该材质渲染时，会读取本实例的 uniforms。
     *
     * @param {THREE.Material} material 要打 patch 的材质
     * @param {THREE.Vector3} [childPivot] 可选：该材质所属 mesh 在 deformTarget 局部空间下的"中心位置"。
     *
     *   背景：身体形变是把"deformTarget 局部空间下的顶点"做非均匀缩放/弯曲。
     *   主身体 mesh（如 bodyMesh）的顶点恰好就在 deformTarget 局部空间里，没问题。
     *   但子 mesh（眼睛、耳朵、柱子的环带等）的 `position` 是"该 mesh 自己的局部顶点坐标"，
     *   它们虽然显示位置在身体里面/上面（通过 mesh.position 偏移），但 shader 拿到的 `position`
     *   只在子 mesh 自己原点附近 → 形变只让眼睛在自己中心被压扁一点，而身体本身大幅形变，
     *   结果眼睛/耳朵和身体分离。
     *
     *   解决方案：给每个子 mesh 的材质单独 attach，并把 childPivot = "子 mesh 在 deformTarget
     *   局部空间下的中心位置"传进来。shader 用 `position + childPivot` 代替 `position` 计算形变，
     *   再减去 childPivot 还原回 mesh 自身局部空间，实现"子 mesh 作为整体跟随身体形变"。
     *
     *   注意：每个子 mesh 必须有独立材质（不能两眼共享一个 eyeMat）。
     */
    attach(material, childPivot) {
        if (!material || material.userData._hitReactionAttached) return;
        material.userData._hitReactionAttached = true;

        const uFlash = this._flashUniform;
        const uFlashColor = this._flashColorUniform;
        const uHitCenter = this._hitCenterUniform;
        const uHitAxis = this._hitAxisUniform;
        const uSpring = this._springUniform;
        const uDentDepth = this._dentDepthUniform;
        const uDentRadius = this._dentRadiusUniform;
        const uSquashAxis = this._squashAxisUniform;
        const uSquashBulge = this._squashBulgeUniform;
        const uStretchAxis = this._stretchAxisUniform;
        const uStretchPinch = this._stretchPinchUniform;
        const uBend = this._bendUniform;
        const uBendDir = this._bendDirUniform;
        const uBendBulge = this._bendBulgeUniform;
        const uBendCurvature = this._bendCurvatureUniform;
        const uBendShear = this._bendShearUniform;
        const uBendPushIn = this._bendPushInUniform;
        const uBendAxisLen = this._bendAxisLenUniform;
        // 该材质独有：子 mesh 在 deformTarget 局部空间下的中心位置。
        // 主 mesh（如 bodyMesh）传 (0,0,0) 即可（即顶点已经在 deformTarget 局部空间里）。
        const uChildPivot = { value: (childPivot ? new THREE.Vector3().copy(childPivot) : new THREE.Vector3(0, 0, 0)) };
        // 暴露给外层（不通过对象引用，外层若要更新需要直接修改这个 uniform.value，下面的 setChildPivot 会用）
        material.userData._hitChildPivotUniform = uChildPivot;

        const prevOnBeforeCompile = material.onBeforeCompile;
        material.onBeforeCompile = (shader) => {
            if (typeof prevOnBeforeCompile === 'function') {
                prevOnBeforeCompile(shader);
            }
            shader.uniforms.uFlashIntensity = uFlash;
            shader.uniforms.uFlashColor = uFlashColor;
            shader.uniforms.uHitCenter = uHitCenter;
            shader.uniforms.uHitAxis = uHitAxis;
            shader.uniforms.uSpring = uSpring;
            shader.uniforms.uDentDepth = uDentDepth;
            shader.uniforms.uDentRadius = uDentRadius;
            shader.uniforms.uSquashAxis = uSquashAxis;
            shader.uniforms.uSquashBulge = uSquashBulge;
            shader.uniforms.uStretchAxis = uStretchAxis;
            shader.uniforms.uStretchPinch = uStretchPinch;
            shader.uniforms.uBend = uBend;
            shader.uniforms.uBendDir = uBendDir;
            shader.uniforms.uBendBulge = uBendBulge;
            shader.uniforms.uBendCurvature = uBendCurvature;
            shader.uniforms.uBendShear = uBendShear;
            shader.uniforms.uBendPushIn = uBendPushIn;
            shader.uniforms.uBendAxisLen = uBendAxisLen;
            shader.uniforms.uChildPivot = uChildPivot;

            // ---------- Vertex: Squash & Stretch 非均匀缩放 + 局部凹陷 ----------
            // 全部在 deformTarget 的局部空间下进行（顶点 position 同一空间）。
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    `#include <common>
                    uniform vec3 uHitCenter;     // deformTarget 局部空间的命中点
                    uniform vec3 uHitAxis;       // deformTarget 局部空间的命中轴（单位向量）
                    uniform float uSpring;       // 弹簧位移（有符号；+squash, -stretch）
                    uniform float uDentDepth;    // 局部凹陷峰值深度（仅正向 s 阶段使用）
                    uniform float uDentRadius;   // 局部凹陷半径
                    uniform float uSquashAxis;   // 压扁阶段沿轴缩短幅度
                    uniform float uSquashBulge;  // 压扁阶段垂直膨胀幅度
                    uniform float uStretchAxis;  // 拉长阶段沿轴拉伸幅度
                    uniform float uStretchPinch; // 拉长阶段垂直收缩幅度
                    uniform float uBend;         // bend 弹簧位移（击退弯曲；signed）
                    uniform vec3 uBendDir;       // 弯曲推动方向（局部空间；= 击退方向，不正交化）
                    uniform float uBendBulge;    // 钟形位移幅度（中间凸、两端滞后；正面命中主导）
                    uniform float uBendCurvature;// 二次弯曲分量幅度（C 形弯曲；侧击主导）
                    uniform float uBendShear;    // 线性剪切分量幅度
                    uniform float uBendPushIn;   // 命中处推入分量幅度
                    uniform float uBendAxisLen;  // 沿命中轴归一化半长（dot/此值 → t∈[-1,1]）
                    uniform vec3 uChildPivot;    // 子 mesh 在 deformTarget 局部空间下的中心位置
                                                 // （主 mesh = (0,0,0)；子 mesh = 它在 bodyMesh 局部空间的位置）
                    `
                )
                .replace(
                    '#include <begin_vertex>',
                    `// 把顶点 position 从"该 mesh 自身局部空间"映射到"deformTarget 局部空间"，
                    // 才能正确参与身体的形变。childPivot 为 (0,0,0) 时此映射等价于 position 本身。
                    // 注意：这里假设子 mesh 自身没有缩放且只有平移（旋转量小）——眼睛/耳朵满足。
                    // 如果子 mesh 有较大旋转，shader 仍能跟随平移正确形变，而 mesh 内部小尺度形状不会被身体形变拉扯，
                    // 这正是我们想要的：眼睛/耳朵作为整体跟随身体走，自身不被切碎。
                    vec3 _local = position + uChildPivot;
                    vec3 transformed = vec3( _local );

                    // —— 把弹簧位移分解为正负两段（同一时刻仅一段非零）——
                    float _sPos = max(uSpring, 0.0);
                    float _sNeg = max(-uSpring, 0.0);

                    // —— 沿命中轴 / 垂直命中轴的非均匀缩放 ——
                    // factorAxis: 沿轴方向。squash 时 <1（被压短），stretch 时 >1（被拉长）
                    // factorPerp: 垂直方向。squash 时 >1（鼓起），stretch 时 <1（收缩）
                    float _factorAxis = 1.0 - _sPos * uSquashAxis + _sNeg * uStretchAxis;
                    float _factorPerp = 1.0 + _sPos * uSquashBulge - _sNeg * uStretchPinch;

                    // 形变以"deformTarget 的局部原点 (0,0,0)"为不动点（敌人身体中心）。
                    // 把顶点分解为沿轴分量 + 垂直分量，分别缩放后再合并。
                    vec3 _axis = normalize(uHitAxis);
                    float _along = dot(transformed, _axis);
                    vec3 _alongVec = _axis * _along;
                    vec3 _perpVec  = transformed - _alongVec;
                    transformed = _alongVec * _factorAxis + _perpVec * _factorPerp;

                    // —— 局部凹陷（仅 squash 阶段，叠加"打击点塌陷"细节）——
                    // stretch 阶段不叠加（顶点已经在被拉长，再凹陷会显得脏）
                    if (_sPos > 0.0 && uDentDepth > 0.0) {
                        float _dDist = distance(_local, uHitCenter); // 用未形变的 _local（已含 pivot），凹陷区域稳定
                        float _dR = max(uDentRadius, 0.001);
                        float _dW = exp(-(_dDist * _dDist) / (_dR * _dR));
                        // 凹陷方向 = 沿命中轴推入身体（与轴同向）
                        transformed += _axis * (uDentDepth * _sPos * _dW);
                    }

                    // —— Bend：方向性"被推弯曲" + 剪切（用 _local 计算 t，包含 childPivot 的偏移）——
                    // t ∈ [-1, 1]：沿命中轴归一化位置，命中点附近 t≈0，远端 |t|≈1
                    //
                    // 四个分量（最终位移 = bendDir * x * 各分量之和）：
                    //   bulge     = (1 - t²) * uBendBulge        钟形：t=0 时最大，|t|=1 时为 0
                    //                                            正面命中（bendDir ≈ axis）主导：
                    //                                            "中间凸出去，两端因惯性滞后"
                    //   curvature = sign(t)*t² * uBendCurvature  二次：t=0 时 0，|t|=1 时最大
                    //                                            侧击（bendDir ⊥ axis）主导：
                    //                                            身体两端往同一方向甩，呈 C 形
                    //   shear     = t * uBendShear               线性：整体被推一下
                    //   pushIn    = -(1 - t²) * uBendPushIn      钟形负向：命中那一面相对身体凹下去
                    //                                            （与 bulge 反号叠加，让命中处凸出更克制）
                    if (abs(uBend) > 0.0001) {
                        float _t = dot(_local, _axis) / max(uBendAxisLen, 0.0001);
                        _t = clamp(_t, -1.5, 1.5);
                        float _absT = abs(_t);
                        float _bell    = max(0.0, 1.0 - _t * _t);                  // 钟形 (1-t²)
                        float _bulge   = _bell * uBendBulge;
                        float _curv    = sign(_t) * _absT * _absT * uBendCurvature;
                        float _shear   = _t * uBendShear;
                        float _pushIn  = -_bell * uBendPushIn;
                        transformed += uBendDir * (uBend * (_bulge + _curv + _shear + _pushIn));
                    }

                    // 把变形后的顶点从 "deformTarget 局部空间" 还原到 "该 mesh 自身局部空间"
                    // （即减去 childPivot；主 mesh 的 pivot 是 0，无副作用）。
                    transformed -= uChildPivot;
                    `
                );

            // ---------- Fragment: 闪白颜色混合 ----------
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>
                    uniform float uFlashIntensity;
                    uniform vec3 uFlashColor;`
                );
            const lastBrace = shader.fragmentShader.lastIndexOf('}');
            if (lastBrace !== -1) {
                shader.fragmentShader =
                    shader.fragmentShader.slice(0, lastBrace) +
                    '\n    gl_FragColor.rgb = mix(gl_FragColor.rgb, uFlashColor, clamp(uFlashIntensity, 0.0, 1.0));\n' +
                    shader.fragmentShader.slice(lastBrace);
            }
        };
        material.needsUpdate = true;

        this._materials.push(material);
    }

    /**
     * 触发一次受击反馈。
     * hitPointWorld: 命中点世界坐标（可为空）
     * hitDirWorld:   命中方向世界单位向量（可为空）
     */
    trigger(hitPointWorld, hitDirWorld) {
        // ---------- 启动闪白 ----------
        this._flashPeak = Math.max(0, Math.min(1, CONFIG.hitFlashIntensity ?? 1.0));
        this._flashDuration = Math.max(0.0001, CONFIG.hitFlashDuration ?? 0.1);
        this._flashTime = 0;
        this._flashUniform.value = this._flashPeak;

        // flashOnly 模式（木桩用）：不启动形变弹簧，shader uniforms 保持为 0
        if (this._flashOnly) {
            return;
        }

        if (!(CONFIG.hitDeformEnabled ?? true)) {
            return;
        }

        // ---------- 把命中点 + 方向转到 deformTarget 的局部空间 ----------
        if (this._deformTarget) {
            this._deformTarget.updateMatrixWorld();

            const center = this._hitCenterUniform.value;
            const axis = this._hitAxisUniform.value;

            if (hitPointWorld) {
                center.copy(hitPointWorld);
                this._deformTarget.worldToLocal(center);
            } else {
                center.set(0, 0, 0);
            }

            if (hitDirWorld) {
                const q = this._deformTarget.getWorldQuaternion(new THREE.Quaternion()).invert();
                this._tmpV1.copy(hitDirWorld).applyQuaternion(q);
                if (this._tmpV1.lengthSq() > 1e-6) {
                    this._tmpV1.normalize();
                    axis.copy(this._tmpV1);
                } else {
                    axis.set(0, 0, 1);
                }
            }
        }

        // ---------- 启动弹簧（归一化幅度峰值=1.0）----------
        // 把弹簧"打到峰值"再松手：x=+1, v=0。后续 ẍ=-k*x-c*v 会驱动它过冲到负值（stretch 阶段）。
        this._springX = 1.0;
        this._springV = 0;
        this._deformTime = 0;
        this._deformActive = true;

        this._springUniform.value = this._springX;
        this._dentDepthUniform.value = Math.max(0, CONFIG.hitDeformDentDepth ?? 0.18);
        this._dentRadiusUniform.value = Math.max(0.01, CONFIG.hitDeformDentRadius ?? 0.7);
        this._squashAxisUniform.value = Math.max(0, CONFIG.hitDeformSquashAxis ?? 0.5);
        this._squashBulgeUniform.value = Math.max(0, CONFIG.hitDeformSquashBulge ?? 0.5);
        this._stretchAxisUniform.value = Math.max(0, CONFIG.hitDeformStretchAxis ?? 0.6);
        this._stretchPinchUniform.value = Math.max(0, CONFIG.hitDeformStretchPinch ?? 0.3);
    }

    /**
     * 触发一次"击退弯曲"形变（与 trigger() 独立通道；通常由 applyKnockback 调用）。
     *
     * 设计意图：纯 squash 是对称的，配合击退看起来很怪——身体应该被推弯。
     * 这里用 knockback 的方向 + 力度驱动一个独立弹簧，让顶点沿"推动方向"做
     * 二次弯曲 + 剪切偏移，呈现"中间被推、两端因惯性滞后"的果冻反应。
     *
     * @param {THREE.Vector3} knockbackDirWorld 击退方向（世界空间单位向量；推开敌人的方向）
     * @param {number}        force            击退力（用于换算弹簧初值）
     */
    triggerBend(knockbackDirWorld, force) {
        if (this._flashOnly) return;
        if (!(CONFIG.hitBendEnabled ?? true)) return;
        if (!knockbackDirWorld || force <= 0) return;
        if (!this._deformTarget) return;

        // 把击退方向转入 deformTarget 局部空间
        this._deformTarget.updateMatrixWorld();
        this._deformTarget.getWorldQuaternion(this._tmpQ).invert();
        this._tmpV1.copy(knockbackDirWorld).applyQuaternion(this._tmpQ);
        // 强制水平化（敌人弯曲应该在水平面里发生，避免上下乱弯）—— 这里仍在 local 空间，
        // 但 deformTarget 的 local Y 与 world Y 接近平行（敌人没有侧翻），所以置零 y 即可
        this._tmpV1.y = 0;
        if (this._tmpV1.lengthSq() < 1e-6) return;
        this._tmpV1.normalize();

        // 注意：以前这里有"与命中轴正交化"的代码，会让 bendDir = bendDir - dot*axis。
        // 但游戏里命中方向 = 击退方向（同一个 currentDir），正交化结果是 0 → bend 永远不触发！
        // 现在不正交化，直接用击退方向作为 bendDir。shader 里有两个分量自适应处理：
        //   · bulge 分量（钟形位移）：当 bendDir ≈ axis 时主导（正面命中 → 中间凸出，两端滞后）
        //   · curvature 分量（C 形弯曲）：当 bendDir ⊥ axis 时主导（侧击 → 横向 C 弯）
        //   · shear 分量（线性偏移）：通用副分量
        this._bendDirUniform.value.copy(this._tmpV1);

        // 注入弹簧初值：x(0) = clamp(force / forceRef, ..., maxImpulse)，v(0)=0
        const forceRef = Math.max(0.0001, CONFIG.hitBendForceRef ?? 10);
        const maxImpulse = Math.max(0.01, CONFIG.hitBendImpulseMax ?? 1.4);
        const impulse = Math.min(maxImpulse, force / forceRef);

        // 如果上一波 bend 还没完，叠加而非覆盖（避免连击时弯曲突然归零）
        this._bendX = Math.min(maxImpulse, Math.abs(this._bendX) * 0.5 + impulse);
        this._bendV = 0;
        this._bendTime = 0;
        this._bendActive = true;

        this._bendUniform.value = this._bendX;
        this._bendBulgeUniform.value = Math.max(0, CONFIG.hitBendBulge ?? 0.35);
        this._bendCurvatureUniform.value = Math.max(0, CONFIG.hitBendCurvature ?? 0.55);
        this._bendShearUniform.value = Math.max(0, CONFIG.hitBendShear ?? 0.30);
        this._bendPushInUniform.value = Math.max(0, CONFIG.hitBendPushIn ?? 0.18);
        this._bendAxisLenUniform.value = Math.max(0.05, CONFIG.hitBendAxisLength ?? 0.5);
    }

    update(delta) {
        // ---------- 闪白线性衰减 ----------
        if (this._flashUniform.value > 0) {
            this._flashTime += delta;
            const k = 1.0 - Math.min(1.0, this._flashTime / this._flashDuration);
            this._flashUniform.value = this._flashPeak * k;
            if (k <= 0) this._flashUniform.value = 0;
        }

        // flashOnly 模式（木桩用）：不更新形变弹簧
        if (this._flashOnly) return;

        // ---------- 弹簧更新 ----------
        if (this._deformActive) {
            this._deformTime += delta;
            const stiffness = CONFIG.hitDeformStiffness ?? 260;
            const damping = CONFIG.hitDeformDamping ?? 6.0;
            // 子步长积分（默认 stiffness 较大，需要 ~6 个子步以内才稳定）
            const steps = 6;
            const dt = delta / steps;
            for (let i = 0; i < steps; i++) {
                const a = -stiffness * this._springX - damping * this._springV;
                this._springV += a * dt;
                this._springX += this._springV * dt;
            }
            this._springUniform.value = this._springX;
            // 同步运行时可调参数（让面板拖动立即生效）
            this._dentDepthUniform.value = Math.max(0, CONFIG.hitDeformDentDepth ?? 0.18);
            this._dentRadiusUniform.value = Math.max(0.01, CONFIG.hitDeformDentRadius ?? 0.7);
            this._squashAxisUniform.value = Math.max(0, CONFIG.hitDeformSquashAxis ?? 0.5);
            this._squashBulgeUniform.value = Math.max(0, CONFIG.hitDeformSquashBulge ?? 0.5);
            this._stretchAxisUniform.value = Math.max(0, CONFIG.hitDeformStretchAxis ?? 0.6);
            this._stretchPinchUniform.value = Math.max(0, CONFIG.hitDeformStretchPinch ?? 0.3);

            // 结束条件：超时或几乎静止（同时检测位移与速度都接近零）
            const maxDur = CONFIG.hitDeformDuration ?? 0.6;
            const nearRest = Math.abs(this._springX) < 0.005 && Math.abs(this._springV) < 0.05;
            if (this._deformTime >= maxDur || nearRest) {
                this._springX = 0;
                this._springV = 0;
                this._springUniform.value = 0;
                this._deformActive = false;
            }
        }

        // ---------- Bend 弹簧（独立运行，参数与 squash 弹簧分离）----------
        if (this._bendActive) {
            this._bendTime += delta;
            const k = CONFIG.hitBendStiffness ?? 180;
            const c = CONFIG.hitBendDamping ?? 9.0;
            const steps = 6;
            const dt = delta / steps;
            for (let i = 0; i < steps; i++) {
                const a = -k * this._bendX - c * this._bendV;
                this._bendV += a * dt;
                this._bendX += this._bendV * dt;
            }
            this._bendUniform.value = this._bendX;
            // 同步运行时可调参数
            this._bendBulgeUniform.value = Math.max(0, CONFIG.hitBendBulge ?? 0.35);
            this._bendCurvatureUniform.value = Math.max(0, CONFIG.hitBendCurvature ?? 0.55);
            this._bendShearUniform.value = Math.max(0, CONFIG.hitBendShear ?? 0.30);
            this._bendPushInUniform.value = Math.max(0, CONFIG.hitBendPushIn ?? 0.18);
            this._bendAxisLenUniform.value = Math.max(0.05, CONFIG.hitBendAxisLength ?? 0.5);

            const bendDur = CONFIG.hitBendDuration ?? 1.0;
            const bendRest = Math.abs(this._bendX) < 0.003 && Math.abs(this._bendV) < 0.04;
            if (this._bendTime >= bendDur || bendRest) {
                this._bendX = 0;
                this._bendV = 0;
                this._bendUniform.value = 0;
                this._bendActive = false;
            }
        }
    }

    /**
     * 外部读取当前弹簧位移（有符号）。木桩通过它驱动 group.scale。
     * 返回的值范围约为 [-0.6, 1.0]：
     *   > 0  squash 阶段（被压扁），| 数值越大越扁
     *   = 0  静止
     *   < 0  stretch 阶段（被拉长），| 数值越大越长
     */
    getSignedDeform() {
        return this._deformActive ? this._springX : 0;
    }

    /** 外部读取当前命中轴（局部空间，已归一化）。木桩用来确定形变方向。 */
    getHitAxisLocal() {
        return this._hitAxisUniform.value;
    }

    /**
     * 敌人死亡或清理时调用，归零所有 uniform。
     */
    reset() {
        this._flashUniform.value = 0;
        this._springUniform.value = 0;
        this._springX = 0;
        this._springV = 0;
        this._deformActive = false;
        this._flashTime = 0;

        this._bendUniform.value = 0;
        this._bendX = 0;
        this._bendV = 0;
        this._bendActive = false;
    }
}
