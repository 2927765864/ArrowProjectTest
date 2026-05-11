// SHIPPING_PRESET：打包发布时的"出厂参数"，由 src/presets/shipping.js 维护。
// 加载顺序：DEFAULT_CONFIG ← SHIPPING_PRESET ← localStorage
//   1. DEFAULT_CONFIG   - 硬编码兜底默认值（保证字段完备）
//   2. SHIPPING_PRESET  - 出厂调好的一套参数（普通用户首启时直接生效）
//   3. localStorage     - 用户/开发者在控制面板里的自定义修改（最高优先级）
import { SHIPPING_PRESET } from './presets/shipping.js';

export const DEFAULT_CONFIG = {
    // =====================================================================
    // 攻击节奏 —— 玩家停下时发射，移动时回收。
    // 上半身和下半身整体一起朝向敌人（不再解耦）。
    // =====================================================================
    shootCooldown: 0.35,
    // ===== 玩家伤害 =====
    // 主动攻击伤害：羽毛飞行途中穿刺命中敌人时造成的伤害（damageType='low'）
    playerAttackDamage: 5,
    // 回收伤害（普通）：前 3 把羽毛回收飞回途中命中敌人造成的伤害（damageType='high'）
    playerRecallDamage: 10,
    // 回收伤害（特殊）：第 4 把特殊羽毛回收时命中敌人造成的伤害（damageType='special'）
    playerRecallDamageSpecial: 80,
    attackWindupDur: 0.22,
    attackWindupDurSpecial: 0.34,
    attackRecoverDur: 0.2,
    attackRecoverDurSpecial: 0.25,
    // 蓄力结束后，到武器实体真正生成飞出之间的额外延后时间。
    // 蓄力一结束角色就立即进入投掷后摇动画（视觉上手开始挥出），但武器
    // 实体（羽毛）会等到这个延后时间过去才被 spawn 并发射。
    // 在这段"武器尚未生成"的窗口内，玩家若通过移动打断，则取消整次攻击
    // （不扔出任何武器），武器永远不会出现；过了这个窗口后再打断，则武器
    // 已经生成飞出，移动只打断剩余的后摇动画（即"有效打断"）。
    // 这样设计可以保证玩家先在视觉上看到武器生成飞出，然后才进入"可被
    // 自由打断"的后摇阶段，避免出现"看见角色挥手但武器没扔出"的违和感。
    attackThrowSpawnDelay: 0.0,
    attackHeldWeaponScale: 0.08,
    attackWindupHoldRatio: 0.45,
    attackWindupHoldRatioSpecial: 0.55,
    // 主动投掷命中时的真实命中停顿（卡肉）；位置/碰撞会一起暂停推进。
    attackHitVisualPause: 0.02,
    attackHitVisualPauseSpecial: 0.03,

    // --- 上半身姿态（单位：弧度） ---
    // 蓄力：X=后仰(负=更仰)，Y=身体向后扭转，Z=侧倾
    attackLeanBackX: -0.65,
    attackLeanBackXSpecial: -0.95,
    attackTwistBackY: -1.05,
    attackTwistBackYSpecial: -1.45,
    attackLeanSideZ: 0.28,
    attackLeanSideZSpecial: 0.38,
    // 投出：X=前倾(正=前倾)，Y=身体跟随前扭，Z=投出后侧倾
    attackThrowForwardX: 0.95,
    attackThrowForwardXSpecial: 1.18,
    attackThrowTwistY: 0.78,
    attackThrowTwistYSpecial: 1.02,
    attackThrowSideZ: -0.22,
    attackThrowSideZSpecial: -0.30,
    // 爆发前挥阶段占整个 recover 的比例（越大，前倾极限维持越久）
    attackBurstRatio: 0.38,
    attackBurstRatioSpecial: 0.42,

    // =====================================================================
    // 投掷手臂（大臂 + 小臂）蓄力姿态
    // =====================================================================
    // 目标是：在"玩家模型坐标系"中（即角色面朝正前方时的坐标），蓄力到极限时：
    //   - 大臂水平横向伸出（平行于身体正平面，指向角色右侧）
    //   - 小臂与大臂成约 90° 夹角，指向身体后上方
    // 由于上半身蓄力时有大幅 Y 扭转，需要反向补偿旋转 —— 下列参数就是反解得到的。
    // 单位：弧度（PI ≈ 3.14，PI*0.5 = 90°，PI*0.25 = 45°）
    // 三个旋转按 YXZ 欧拉角顺序作用于 rightArm / leftArm（因 attackSide 对称）。
    attackArmPullX:         -0.53,  // 普通攻击：大臂 X 轴旋转（≈ -0.17π）
    attackArmPullXSpecial:  -0.79,  // 特殊攻击：≈ -0.25π
    attackArmPullY:          1.13,  // 普通攻击：大臂 Y 轴旋转（≈  0.36π）
    attackArmPullYSpecial:   1.32,  // 特殊攻击：≈  0.42π
    attackArmPullZ:         -1.23,  // 普通攻击：大臂 Z 轴旋转（≈ -0.39π）
    attackArmPullZSpecial:  -0.88,  // 特殊攻击：≈ -0.28π
    // 小臂相对大臂的弯曲角（X 轴），-PI/2 = 小臂与大臂成精确 90° 直角
    attackElbowBendPull:        -1.5708,  // -PI/2，小臂垂直大臂
    attackElbowBendPullSpecial: -1.5708,

    // =====================================================================
    // 手持武器（蓄力时显示）模型方位调节
    // =====================================================================
    // 武器挂在 player.mesh（玩家根 Group）之下，参考系 = “玩家整体朝向”。
    //   - 玩家正前方 = -Z；正右方 = +X；上方 = +Y
    //   - 武器内部 createWeaponModel() 默认尖端朝 +Z，所以这里 RotY 默认 = PI
    //     让尖端转向 -Z（玩家正前方），整体平行于地面。
    //
    // 这套参数让武器与 forearm/elbow 蓄力旋转完全脱耦——蓄力期间武器始终
    // 平行地面、尖端朝前，不会跟着前臂翻转。位置仅做小幅微调以贴近右手腕。
    attackWeaponHoldPosX: 0.10,        // X：身体右侧（右手）
    attackWeaponHoldPosY: 0.45,        // Y：肩/手腕高度
    attackWeaponHoldPosZ: -0.05,       // Z：略微靠前
    attackWeaponHoldRotX: 0.0,         // X：保持水平
    attackWeaponHoldRotY: Math.PI,     // Y：尖端转向 -Z（玩家正前方）
    attackWeaponHoldRotZ: 0.0,         // Z：保持水平
    // 蓄力时武器的 Z 轴位移动画：
    //   * StayRatio：从蓄力开始算的"静止占比"，0..1。这段时间武器停在【默认位置】；
    //                为 1 时全程静止（关闭动画）。
    //   * OffsetZ  ：终点相对默认位置的 Z 偏移（局部坐标；玩家正前 = -Z，
    //                所以负值 = 终点更靠前；正值 = 终点更靠后）。
    // 蓄力剩下的时间内，武器从默认位置 easeOutCubic 平滑滑到终点 (默认 + OffsetZ)，
    // 蓄力结束时正好抵达终点 = 出手消失。
    attackWeaponHoldStayRatio: 0.5,
    attackWeaponHoldOffsetZ: -0.4,
    // ---------------------------------------------------------------------
    // 武器“弹性出现”缩放动画（仅作用于 scale，不影响 Z 位移动画）
    //   * Enabled    : 总开关；关闭后退化为旧版“瞬间出现到 targetScale”行为。
    //   * Duration   : 弹性动画总时长（秒）。仅在武器从隐藏→显示的边沿触发，
    //                   持续此时长内做 0 → 峰值 → 1.0 的两段缩放，超过后锁到
    //                   targetScale（普攻 1.0 / 特殊攻击 1.4）。
    //   * Overshoot  : 峰值倍率（相对 targetScale）。0..1 之间取前一半时间
    //                   easeOut 冲到 overshoot×targetScale，后一半时间 easeOut
    //                   回落到 targetScale。例如 overshoot=1.2、targetScale=1
    //                   时路径为 0 → 1.2 → 1.0；overshoot=1.0 时退化为简单
    //                   弹出无超冲。
    attackWeaponHoldPopEnabled: true,
    attackWeaponHoldPopDuration: 0.18,
    attackWeaponHoldPopOvershoot: 1.2,

    // =====================================================================
    // 辅助手（非投掷侧）蓄力 / 投出 姿态
    // =====================================================================
    // 右手投掷时，辅助手 = 左手。参数语义与 attackArmPull* 完全相同，
    // 也是反解得到的大臂三轴旋转（YXZ 顺序）+ 小臂 X 弯曲。
    //
    // 目标姿态（在"角色模型坐标系"中，角色面朝 -Z 时）：
    //   蓄力 WINDUP：大臂向前伸出（-Z 前方），小臂横在胸前（-X 指向投掷手那一侧，
    //                类似抱胸或托住武器的姿态）。
    //   投出 THROW ：大臂向后甩到身后（+Z 后方），小臂自然下垂并跟随摆到身后。
    //
    // 这两组旋转会与投掷手臂的 windup / throw 同相插值（同一动画曲线），
    // 保证双手的摆动节奏完全同步。
    attackSupportArmWindupX:        0.0,    // ≈ 0
    attackSupportArmWindupXSpecial: 0.09,   // ≈ 0.03π
    attackSupportArmWindupY:        0.0,    // ≈ 0
    attackSupportArmWindupYSpecial: 0.0,    // ≈ 0
    attackSupportArmWindupZ:       -1.48,   // ≈ -0.47π
    attackSupportArmWindupZSpecial:-1.31,   // ≈ -0.42π
    attackSupportElbowWindup:      -1.73,   // ≈ -0.55π（约 99° 弯曲）
    attackSupportElbowWindupSpecial:-1.73,  // ≈ -0.55π

    attackSupportArmThrowX:         0.0,    // ≈ 0
    attackSupportArmThrowXSpecial: -0.35,   // ≈ -0.11π
    attackSupportArmThrowY:         0.09,   // ≈ 0.03π
    attackSupportArmThrowYSpecial:  0.0,    // ≈ 0
    attackSupportArmThrowZ:        -1.22,   // ≈ -0.39π
    attackSupportArmThrowZSpecial: -0.87,   // ≈ -0.28π
    attackSupportElbowThrow:       -0.94,   // ≈ -0.30π（辅助手投出后小臂放松）
    attackSupportElbowThrowSpecial:-0.94,   // ≈ -0.30π

    // =====================================================================
    // 下半身 —— 弓步蓄势站姿 + 攻击腿部摆动
    // =====================================================================
    // 核心原则：
    //   1. 双腿挂在独立的 legsAnchorGroup 上，不跟随上半身扭转；脚在 XZ
    //      平面上完全由腿自己的旋转控制，不会被攻击扭身"甩飞"。
    //   2. Idle 站姿 = 弓步：前腿大腿前倾 + 小腿后折（屈膝明显，脚落前方）；
    //      后腿大腿略后倾 + 小腿微弯（脚落后方，后蹬感）。
    //   3. 攻击时，大腿和小腿一起小幅摆动（windup 后坐、throw 前送），
    //      因为大腿和小腿同步变化，脚相对胯只有小幅漂移（不滑步）。
    // plantLeg = 投掷手对侧腿 = 前腿
    // rearLeg  = 投掷手同侧腿 = 后腿
    //
    // --- 站姿基础姿态（idle 时的弓步）---
    // 约定：所有参数都是【正值 = 更夸张】的直观语义
    // 单位：弧度（0.30 ≈ 17°）
    attackStanceFrontThigh: 0.32,   // 前腿大腿前倾（正 = 脚更向前）
    attackStanceFrontKnee: 0.55,    // 前腿膝盖弯曲度（正 = 膝盖更弯）
    attackStanceRearThigh: 0.15,    // 后腿大腿后倾（正 = 脚更向后）
    attackStanceRearKnee: 0.25,     // 后腿膝盖弯曲度（正 = 膝盖更弯）

    // --- 攻击时的动作叠加量（约定：正值 = 更夸张）---
    attackLegWindupThigh: 0.08,     // 蓄力阶段：双腿后坐幅度（正 = 更后坐）
    attackLegWindupKnee: 0.10,      // 蓄力阶段：加深屈膝幅度（正 = 更深下蹲）
    attackLegThrowThigh: 0.10,      // 发力阶段：向前送胯幅度（正 = 更前冲）
    attackLegThrowKnee: 0.18,       // 发力阶段：膝盖伸展幅度（正 = 更伸直）

    // --- 胯部跟随：上半身扭转/侧倾时，腿根按比例一起转（让腰部有连动感）---
    // 0.0 = 腿根完全不动；1.0 = 跟上半身 1:1（会让脚大幅扫动，不推荐）
    // 推荐 0.3~0.5：视觉上有腰胯连接，脚只划出一个很小的弧。
    attackHipFollowY: 0.40,         // Y 扭转跟随比例
    attackHipFollowZ: 0.35,         // Z 侧倾跟随比例
    // --- 攻击旋转轴心：以左脚着地点为圆心（让身体围绕支撑脚发力）---
    // 左脚位置相对 tiltGroup 局部坐标：x=左胯水平偏移，z=前后偏移（0=与胯部对齐）
    // 基础骨架里左腿在 bodyGroup 局部 (0.055, -0.05, 0)，加上站立高度=地面≈y=0。
    attackLeftFootPivotX: 0.055,
    attackLeftFootPivotZ: 0.0,

    // --- 胯部/下半身旋转（hipPivotGroup rotation，会带动双腿和尾巴）---
    // 数值为上半身参数的一个比例跟随，让投掷动作从胯部发力更自然
    // 蓄力时胯部跟随扭转 Y 和侧倾 Z
    attackHipTwistBackY: -0.22,           // 蓄力时胯部向后扭（跟随上半身方向，幅度较小）
    attackHipTwistBackYSpecial: -0.32,
    attackHipLeanSideZ: 0.10,             // 蓄力时胯部侧倾
    attackHipLeanSideZSpecial: 0.15,
    // 投出时胯部跟随前扭和侧倾
    attackHipThrowTwistY: 0.18,           // 投出时胯部前扭
    attackHipThrowTwistYSpecial: 0.25,
    attackHipThrowSideZ: -0.08,           // 投出时胯部侧倾反向
    attackHipThrowSideZSpecial: -0.12,

    // 身体下蹲高度（相对站立 y=0.25）
    attackBodyDipWindup: 0.05,            // 蓄力时下蹲量
    attackBodyDipWindupSpecial: 0.08,
    attackBodyLiftThrow: 0.08,            // burst 投出瞬间上顶
    attackBodyLiftThrowSpecial: 0.13,
    deployInitialSpeed: 60,
    deployFriction: 80,
    deployMinSpeed: 15,
    maxFeathersOnField: 50,
    pierceDistBeforeDrop: 1.5,              // 关闭动态时使用的固定穿透后落点距离（向后兼容）
    // === 穿透后落点距离 · 动态映射（基于玩家发射时与目标敌人的距离） ===
    // 启用后：玩家离敌人越近 → 落点越远；越远 → 落点越近。线性插值 + 钳制。
    // 公式（仅当 pierceDistDynamicEnabled = true 时生效）：
    //   设 d = 玩家到目标敌人的水平距离
    //   若 d ≤ pierceTriggerNearDist        → 落点 = pierceDistMax     （触发"最远落点"）
    //   若 d ≥ pierceTriggerFarDist         → 落点 = pierceDistMin     （触发"最近落点"）
    //   两者之间                             → 在 [pierceDistMax → pierceDistMin] 之间线性插值
    pierceDistDynamicEnabled: false,        // 是否启用动态落点距离（关闭时使用 pierceDistBeforeDrop 固定值）
    pierceDistMin: 1.0,                     // 最近落点（玩家很远时使用）
    pierceDistMax: 4.0,                     // 最远落点（玩家很近时使用）
    pierceTriggerNearDist: 2.0,             // 触发"最远落点"的最近距离：玩家-敌人 ≤ 此值 → 落点 = pierceDistMax
    pierceTriggerFarDist: 12.0,             // 触发"最近落点"的最远距离：玩家-敌人 ≥ 此值 → 落点 = pierceDistMin
    attackPostPierceSpeedScale: 0.3,
    groundInsertPitch: 80,
    // 穿透后下坠时 pitch 旋转的支点偏向（0 = 绕武器中心，沿用旧行为；1 = 绕武器头尖；可超过 1 以进一步前移）
    attackPitchPivotTipBias: 1.0,
    // 在"头尖"基础上沿武器朝向（尖端方向）的额外微调距离（单位：世界单位），正值再向头尖外延伸
    attackPitchPivotTipOffset: 0.0,
    recallInterval: 100,
    recallMoveDistanceAfterStop: 1.0,
    baseRecallSpeed: 70,
    finalRecallDelay: 300,
    finalRecallSpeed: 20,
    deployRingRadiusNormal: 0.58,
    deployRingRadiusSpecial: 0.78,
    deployRingOpacityNormal: 0.82,
    deployRingOpacitySpecial: 1.0,
    deployArrowScale: 1.0,
    deployArrowLength: 1.0,
    deployArrowOpacity: 0.82,
    recallCourierEmergeDur: 0.3,
    recallCourierWindupDur: 0.5,
    recallCourierThrowDur: 0.15,
    recallCourierHoldDur: 0.2,
    recallCourierFadeDur: 1.5, // 独立于主动画之外的消失渐隐时长（秒）
    recallCourierScale: 1.3,
    recallCourierScaleSpecial: 1.48,
    recallCourierWeaponScale: 0.54,
    recallCourierWeaponScaleSpecial: 0.66,
    recallCourierWeaponOffsetX: -0.01,
    recallCourierWeaponOffsetY: -0.006,
    recallCourierWeaponOffsetZ: 0.045,
    recallCourierWeaponBaseRotX: 180,
    recallCourierWeaponBaseRotY: 0.0,
    recallCourierWeaponBaseRotZ: 0.0,
    recallCourierWeaponWindupRotX: 86,
    recallCourierWeaponThrowRotX: 57,
    sceneMode: 'obstacles', // endless, empty, obstacles, dummy, wave4
    wave4Count: 4,
    wave4RespawnDelay: 0.6,
    floorStyle: 'brick', // solid, checkerboard, brick
    maxMoveSpeedX: 7.5,
    maxMoveSpeedZ: 10,
    showPlayerTrajectory: false,
    showCollisionBox: false,
    // 屏幕右上角显示实时帧率（FPS）。默认关闭；从参数面板"🖥 UI 与界面"分组里切换。
    showFps: false,
    useCustomCollision: false,
    customCollisionRadius: 0.2,
    cameraMode: 'orthographic',
    cameraFov: 45,
    cameraDist: 60,
    cameraAngleX: 55,
    cameraAngleY: 0,
    cameraViewScale: 1.0,
    cameraFollowEnabled: true,
    // 镜头跟随缓动开关：开启后镜头追玩家时不再 1:1 锁死，
    // 而是用一个临界阻尼弹簧 + 最大速度限制来缓起缓停。
    cameraFollowSmoothing: true,
    // 平滑时间常数（秒）。值越小，镜头追上玩家越快；
    // 值越大，缓起缓停越明显。0 视为关闭平滑（瞬切）。
    cameraFollowSmoothTime: 0.18,
    // 镜头跟随时的最大移动速度（世界单位 / 秒）。
    // 防止玩家瞬移或大跨度位移时镜头被拽出过快的位移感。
    cameraFollowMaxSpeed: 40,
    turnSpeed: 18,
    // Angular velocity used specifically for the transition from the frozen
    // attack facing to the movement facing when an attack is interrupted by
    // the player starting to move. Kept separate from turnSpeed so the
    // "snap-out" from attack pose can be tuned independently. Unit: same as
    // turnSpeed (multiplied by delta in slerp's t parameter).
    attackBreakTurnSpeed: 18,
    // Angular velocity used specifically for the transition from the
    // movement facing to the attack facing when the player stops moving
    // and begins a new attack sequence. Kept separate from turnSpeed so the
    // "snap-in" to attack pose can be tuned independently. Same unit as
    // turnSpeed.
    moveToAttackTurnSpeed: 18,
    moveAcceleration: 25,
    moveFriction: 12,
    bloomStrength: 0.3,
    bloomThreshold: 0.1,
    bloomRadius: 0.5,
    xrayEnabled: true,
    playerOutlineEnabled: true,
    playerOutlineThickness: 1.2,
    // 在 Crease Pass 内启用 "部位 ID 接缝线"：当相邻像素属于不同肢体（如上臂↔前臂、
    // 左大腿↔左小腿、双臂↔躯干），即使法线方向相近也会画一条与现有 crease 同色同宽的细线。
    // 关节球 partId=0 充当缓冲带不参与 ID 判定，过渡更自然。
    // 关闭此开关可退化为旧版"仅法线判据"行为。
    playerOutlinePartSeams: true,
    playerScale: 2.5,
    // 玩家脚底圆形阴影（blob shadow）的基础半径（米）。
    // 实际渲染半径 = playerShadowRadius * shadowScale（弹跳越高越小）。
    playerShadowRadius: 0.22,
    indicatorMaxRange: 0.6,
    indicatorMaxInput: 1.8,
    enemyScale: 2.0,
    // 普通敌人血量（isDummy=true 的训练假人会忽略此值固定为 Infinity）
    enemyHP: 160,
    // 敌人移动速度：实际速度 = enemyMoveSpeedBase + random(0,1) * enemyMoveSpeedRandom
    enemyMoveSpeedBase: 2.5,
    enemyMoveSpeedRandom: 1.5,
    // ===== 柱状敌人（PillarEnemy）=====
    // 生成后静止不动，周期性向玩家吐出缓慢移动的球形子弹
    pillarEnemyHP: 160,             // 柱状敌人血量
    pillarEnemyFireInitDelay: 1.2,  // 生成后首次开火延迟（秒）
    pillarEnemyFireInterval: 1.8,   // 两次开火的间隔（秒）
    pillarEnemyFireWindup: 0.35,    // 开火前顶部眼"蓄力闪烁"时长（秒，仅视觉提示）
    pillarBulletSpeed: 4.0,         // 子弹飞行速度（单位/秒）
    pillarBulletLifetime: 3.0,      // 子弹存在时长（秒），到期自动消失
    pillarBulletRadius: 0.25,       // 子弹核心半径
    // wave4 中柱状敌人的数量（其余位置用普通敌人填充）
    wave4PillarCount: 2,

    // =====================================================================
    // 敌人受击反馈（统一：球形敌人 / 柱状敌人 / 木桩 共用同一组参数）
    // =====================================================================
    // 设计原则：所有敌人共享同一组手感参数，调一次面板，三类敌人同时生效。
    //   · 闪白              → 三类共用（颜色混合，shader/直接染色统一时长 + 强度）
    //   · 弹性形变           → 三类共用（球形/柱状走 shader 顶点凹陷；木桩走 group 缩放，
    //                                    但参数语义对齐：Depth/Stiffness/Damping/Duration/Squash 同名）
    //   · 击退/眩晕          → 三类共用（木桩、柱状不会真的位移，但弯曲/反应强度会按击退力换算）
    //   · 木桩 pivot 弯曲     → 木桩独有（球形敌人无此物理特性），单独一组 stakeBend*

    // ----- 闪白（所有敌人）-----
    // 闪白以"颜色混合"方式叠加在基础色上。intensity=1 时完全白色覆盖，0 时无效果。
    // 实现上每帧从峰值线性衰减到 0，持续时间为 duration 秒。
    hitFlashDuration: 0.12,       // 闪白从峰值衰减到 0 的总时长（秒）
    hitFlashIntensity: 1.0,       // 闪白峰值强度（0~1）。1 = 纯白覆盖；0.5 = 半白半原色

    // ----- 弹性形变 · "Squash & Stretch" 模型（所有敌人共用）-----
    // 设计思路（迪士尼经典动画"挤压与拉伸"）：
    //   命中瞬间，敌人沿命中方向被"压扁"（squash），同时垂直方向"鼓起"；
    //   弹簧过冲到反向时，敌人沿命中方向"拉长"（stretch），同时垂直方向"收缩"；
    //   最后回到原始比例。两阶段由同一个欠阻尼弹簧 s(t) 自然衔接：
    //     · s > 0  →  squash（被压扁）
    //     · s < 0  →  stretch（过冲拉长）
    //   通过欠阻尼比 ζ ≈ 0.18 让弹簧自然过冲一次明显，再衰减 1~2 次轻微余振。
    //
    // 形变实现：
    //   球形/柱状敌人：shader vertex 里做"沿命中轴非均匀缩放 + 局部凹陷"（不与 bodyMesh.scale 的 bounce 动画冲突）
    //   木桩：deformGroup.scale 整体缩放（与 shader 等效，因为木桩是多 mesh 组）
    //
    // 数值稳定性：
    //   stiffness=220, damping=14 时，自然频率 ω=√220≈14.8, 阻尼比 ζ=14/(2*14.8)≈0.47——临界欠阻尼，过冲较弱。
    //   想要"果冻感"建议把 damping 调到 5~8（ζ≈0.17~0.27），过冲会明显得多。
    hitDeformEnabled: true,       // 受击弹性形变总开关（关闭后所有敌人都无形变）
    hitDeformStiffness: 260,      // 弹簧刚度（越大回弹越快越"硬"。260 → ω≈16, 周期≈0.39s）
    hitDeformDamping: 6.0,        // 阻尼（决定过冲次数。6 → ζ≈0.18, 1 次明显过冲 + 1~2 次轻微余振）
    // 兜底时长：超过后强制把弹簧位移截到 0。需要足够长以包含所有可见余振，否则会有突变。
    // 对默认 stiffness=260, damping=6.0：t=0.5s 经过 stretch 峰值后回到 ≈0，t=0.8s 二次余振
    // 振幅约 0.09，t=1.2s 已不可见。但 nearRest 阈值（位移<0.005）会先让它在 ~1s 自然结束。
    hitDeformDuration: 1.2,       // 形变兜底时长（秒）

    // —— Squash 阶段（s>0，被压扁；峰值=1.0 时的形变幅度）——
    // 沿命中轴的"被压短"比例。0.5 表示峰值时该方向缩到 50%；0.75 = 缩到 25%（极端 cartoonish）
    hitDeformSquashAxis: 0.5,
    // 垂直命中轴的"鼓起"比例。0.5 表示峰值时垂直方向膨胀到 150%
    hitDeformSquashBulge: 0.5,

    // —— Stretch 阶段（s<0，弹簧过冲反向；峰值=|过冲| 时的形变幅度）——
    // 沿命中轴的"拉长"比例。0.6 表示过冲峰值时该方向拉到 160%
    hitDeformStretchAxis: 0.6,
    // 垂直命中轴的"收缩"比例。0.3 表示过冲峰值时垂直方向缩到 70%
    hitDeformStretchPinch: 0.3,

    // —— 局部凹陷（仅球形/柱状 shader，叠加在整体缩放之上）——
    // 在命中点附近做一个高斯衰减的局部凹陷，增加"打击感"细节。
    // 设为 0 可完全关闭，只保留整体 squash & stretch。
    hitDeformDentDepth: 0.18,     // 局部凹陷深度（相对身体半径比例）
    hitDeformDentRadius: 0.7,     // 凹陷影响半径（局部空间单位）

    // ----- 击退 & 眩晕（所有敌人，木桩柱状会被各自实现忽略位移）-----
    // 命中时由 Feather 调用 enemy.applyKnockback / applyStun。
    //   · 球形敌人：knockback 真实位移 + stun 期间停止 AI
    //   · 柱状敌人：忽略 knockback；stun 期间停火
    //   · 木桩：knockback 转化为弯曲冲量（按 stakeKnockbackBendScale 换算），无 stun
    hitKnockbackForce: 10,        // 主动攻击命中时的击退力（球形敌人冲量倍数）
    hitStunDuration: 0.15,        // 回收命中时的眩晕时长（秒）

    // ----- "随击退弯曲"形变（Bend / Follow-Through，球形&柱状敌人，shader 顶点偏移）-----
    // 设计动机：
    //   纯 Squash & Stretch 是沿命中轴对称的"压扁/拉长"，不带方向性。
    //   但游戏里命中是"主动推开敌人"——身体应该呈现"中间被推、两端因惯性滞后"的弯曲。
    //   类似果冻被拍一巴掌：被打的那一面整体往后凸，但身体上下两端还停在原处，呈"中凸两端凹"。
    //
    // 数学模型（在 shader vertex 中执行，沿 uBendDir 方向给所有顶点加位移）：
    //   令 t = dot(position, hitAxis) / R   （归一化沿命中轴位置，命中点 t≈0，远端 |t|≈1）
    //   令 x = bend 弹簧位移（由 applyKnockback 触发，按击退力大小注入初值；带余振）
    //
    //   位移 = bendDir * x * (
    //       (1 - t²) * uBendBulge          ← 钟形位移：t=0 处最大，|t|=1 处为 0
    //                                        正面命中时主导，呈"中间凸出，两端滞后"
    //     + sign(t)*t² * uBendCurvature    ← 二次弯曲：t=0 处 0，|t|=1 处最大
    //                                        侧击时主导，呈 C 形横向弯
    //     + t * uBendShear                 ← 线性剪切：整体被推一下
    //     - (1 - t²) * uBendPushIn         ← 钟形负向：让命中处凸出更克制
    //   )
    //
    //   bendDir = 击退方向（在 deformTarget 局部空间的水平投影；不正交化）。
    //   游戏里 bendDir 总是 ≈ hitAxis（正面命中），所以 bulge 是主要发挥效果的分量；
    //   curvature 留给将来可能的侧击场景。
    //
    // 弹簧（与 hitDeform 弹簧并行，参数独立）：
    //   ẍ = -k*x - c*ẋ；初值由 applyKnockback(force) 注入：
    //     x(0) = clamp(force / hitBendForceRef, 0, hitBendImpulseMax)
    //   阻尼比建议 ζ ≈ 0.25~0.4：摆动 1 次明显回弹后衰减（弯曲不该震太久）。
    //
    // 想要"果冻惯性感"更明显：调大 hitBendBulge 和 hitBendImpulseMax，调小 hitBendDamping。
    // 想要更"夸张"：把 hitBendBulge 调到 1.0 以上、hitBendForceRef 调到更小（同样力下注入更大初值）。
    hitBendEnabled: true,         // 弯曲形变总开关
    hitBendStiffness: 180,        // 弹簧刚度（ω=√180≈13.4，周期 ≈0.47s，比 squash 略慢）
    hitBendDamping: 9.0,          // 阻尼（ζ ≈ 0.34，1 次明显反弹后快速衰减）
    hitBendDuration: 1.0,         // 兜底时长（秒）
    hitBendForceRef: 10,          // 击退力归一化参考值（force=此值时 x(0)=1.0 = 满量程弯曲）
    hitBendImpulseMax: 1.4,       // 弯曲弹簧初值上限（防止极端击退力把弯曲量打飞）
    hitBendBulge: 0.45,           // ★ 主要分量：钟形位移幅度（"中间凸出、两端因惯性滞后"）
                                  //    正面命中时这是唯一明显生效的分量。想看到惯性形变就调它。
                                  //    单位是"位移 / 身体半径"。0.45 = 命中点峰值位移 ≈ 半径的 45%
    hitBendCurvature: 0.0,        // 二次弯曲分量幅度（侧击 C 形弯）
                                  //    游戏里没有侧击场景，默认 0；如果你做侧击攻击可调到 0.3~0.6
    hitBendShear: 0.20,           // 线性剪切分量幅度（"整体被推一下"的偏移程度，副分量）
    hitBendPushIn: 0.18,          // 命中处反凹幅度（与 bulge 反号叠加，让中间凸出更克制；想纯凸调到 0）
    hitBendAxisLength: 0.5,       // 沿命中轴的归一化半长（用于把 dot(p,axis) 归一到 t ∈ [-1,1]，
                                  //   球体半径 ≈0.38，所以 0.5 让大部分顶点 t 在 [-0.76, 0.76] 区间）

    // ----- 木桩独有：Squash & Stretch 形变（与 hitDeform* 完全独立，木桩自己一组）-----
    // 设计理由：木桩是直立圆柱，与球形/柱状敌人的几何形态/视觉重量差异较大，
    //   共享一组 hit* 参数难以同时让两者都"恰到好处"。所以拆开两套参数，调球形敌人时
    //   不影响木桩，反之亦然。语义和数学模型与 hitDeform* 完全一致：
    //     · 受击瞬间，弹簧位移 s=+1（squash 阶段）；过冲到 s<0（stretch 阶段）；最后衰减回 0
    //     · sPos = max(s, 0) 时被压扁；sNeg = max(-s, 0) 时被拉长
    //   实现上：木桩在 update() 里跑自己的局部弹簧，应用到 deformGroup.scale 上（多 mesh 整体缩放）。
    //
    // 默认值复制自当前 hitDeform*——也就是之前已经调适给球形敌人的那组手感作为木桩起点，
    // 用户可在面板里单独调到木桩合适的强度。
    stakeDeformStiffness: 260,    // 弹簧刚度（参考 hitDeformStiffness 同义）
    stakeDeformDamping: 6.0,      // 阻尼（越小越 q 弹）
    stakeDeformDuration: 1.2,     // 形变兜底时长（秒）
    // —— Squash 阶段（s>0，被压扁）——
    stakeDeformSquashAxis: 0.5,   // 沿命中轴缩短幅度
    stakeDeformSquashBulge: 0.5,  // 垂直命中轴鼓起幅度
    // —— Stretch 阶段（s<0，过冲拉长）——
    stakeDeformStretchAxis: 0.6,  // 沿命中轴拉伸幅度
    stakeDeformStretchPinch: 0.3, // 垂直命中轴收缩幅度
    // —— 纵向缩放衰减系数 ——
    // 木桩是直立圆柱，Y 方向（高度）变化太大会显得"突然变高/变矮"很违和。
    // 这个系数把 Bulge/Pinch 在 Y 方向上的影响乘以 verticalScale，让上下方向有响应但不喧宾夺主。
    // 0.0 = Y 方向完全不变；1.0 = Y 方向与横向同强度；建议 0.4~0.7。
    stakeDeformVerticalScale: 0.6,

    // ----- 木桩独有：pivot 弯曲弹簧（球形敌人没有这种物理特性，独立一组）-----
    // 弯曲用 2D 角度 (x, z) 表示木桩绕 X / Z 轴的倾倒角，弹簧方程: a = -k*x - c*v。
    //   自然频率 ω = sqrt(stiffness)；阻尼比 ζ = damping / (2*ω)。
    //   默认 ω≈10.5（周期 0.6s），ζ≈0.12（欠阻尼，会摆动 2~3 次后稳定）。
    stakeBendStiffness: 110,      // 弯曲回弹刚度（越大摆动频率越高、越"硬"）
    stakeBendDamping: 2.6,        // 弯曲阻尼（小→明显摆动；大→一次性回正）
    stakeBendMaxAngle: 0.9,       // 最大弯曲角（rad，约 52°），防止穿透地面
    // 受击冲量（注入弯曲角速度的强度），按伤害类型分级：
    stakeBendImpulseLow: 2.0,     // 主动攻击穿刺命中（damageType='low'）
    stakeBendImpulseHigh: 4.5,    // 普通回收命中（damageType='high'）
    stakeBendImpulseSpecial: 6.5, // 特殊回收命中（damageType='special'）
    // 当 Feather 额外调用 applyKnockback(force) 时，木桩把击退力换算成弯曲冲量的系数：
    //   impulse = stakeKnockbackBendScale * min(force, 20) / 10
    //   默认 0.35 → force=10 时额外贡献 ≈ 3.5 弯曲冲量
    stakeKnockbackBendScale: 3.5,

    // =====================================================================
    // 暴击 (Critical Hit) —— 仅作用于"主动攻击"（damageType='low'，即羽毛飞行
    // 途中穿刺命中），不影响回收命中。一定概率触发，触发时：
    //   1) 伤害数字直接显示固定常量 critDamage（默认 480），并且实际伤害也用此值
    //   2) 数字本身的动效走独立的 dmgCritAtk* 参数组（与 dmgAtk* 完全平行，
    //      由 utils.js 的 dmgPrefix('critAtk') 路由），颜色复用现有 .text-crit
    //      （亮黄、26px 基础字号）
    //   3) 击退力度替换为 critKnockbackForce（默认 30，普通主动攻击为 10）
    //   4) 在敌人身上额外生成一个"回收命中爆体"粒子特效（EnemyHitBurstEffect）
    //      —— 完全复用 1 把武器普通回收命中那一档表现：scale=1.0, mergeCount=1，
    //      不与回收命中的合并状态共用，单次独立爆发。
    // =====================================================================
    critEnabled: true,                    // 暴击总开关；关闭后所有主动攻击都按普攻处理
    critChance: 0.30,                     // 暴击触发概率 (0~1)
    critDamage: 480,                      // 暴击固定伤害值（同时作为伤害数字显示值，不走 playerAttackDamage*倍率）
    critKnockbackForce: 30,               // 暴击命中时替换 hitKnockbackForce 的击退冲量

    // 暴击粒子特效：复用回收命中的 EnemyHitBurstEffect。下面两个参数控制
    // "复用 1 情况下的效果"，默认 scale=1.0、mergeCount=1（即与普通回收单次命中完全一致）。
    // 用户可在面板里独立调整。
    critBurstScale: 1.0,                  // 传给 EnemyHitBurstEffect 的整体缩放
    critBurstMergeCount: 1,               // 传给 effect.addBurst() 的合并计数（影响双端点曲线插值的强度位置）

    // ----- 暴击 · 伤害数字动效（与 dmgAtk* 字段一一对应、完全平行）-----
    // 默认值在 dmgAtk* 基础上整体放大一档，体现"更夸张更重"。
    // 如果想让暴击与普通主动攻击数字动效一致，可在面板里把这些值复制成 dmgAtk* 的值。
    dmgCritAtkMoveTimeRatio: 0.2,
    dmgCritAtkHoldRatio: 0.18,
    dmgCritAtkFadeRatio: 0.08,
    dmgCritAtkLife: 1.4,
    dmgCritAtkBurstDistMin: 4.5,
    dmgCritAtkBurstDistMax: 7.0,
    dmgCritAtkBurstUpMin: 0,
    dmgCritAtkBurstUpMax: 0,
    dmgCritAtkShakeAmpStart: 35,
    dmgCritAtkShakeAmpMid: 18.75,
    dmgCritAtkShakeAmpEnd: 2.5,
    dmgCritAtkShakeAppearCurve: 3.0,
    dmgCritAtkShakeEndCurve: 3.0,
    dmgCritAtkScaleStart: 0,
    dmgCritAtkScalePunch: 3.6,            // 比 dmgAtkScalePunch(2.4) 更大
    dmgCritAtkScaleHold: 3.2,             // 比 dmgAtkScaleHold(2.2)  更大
    dmgCritAtkScaleEnd: 2.8,              // 比 dmgAtkScaleEnd(2.0)   更大
    dmgCritAtkDirJitterDeg: 0,

    // 暴击 · 逐字"从天而降"动效（与 dmgAtkChar* 一一对应）
    dmgCritAtkCharStaggerEnabled: 1,
    dmgCritAtkCharGapStart:  0.04,
    dmgCritAtkCharGapEnd:    0.10,
    dmgCritAtkCharDurStart:  0.20,
    dmgCritAtkCharDurEnd:    0.45,
    dmgCritAtkCharPeakStart: 1.6,
    dmgCritAtkCharPeakEnd:   2.8,

    // ===== 主动攻击 · 击中流星火花特效（HitSparkEffect）=====
    // 玩家主动攻击命中敌人时，在矛尖刺入点生成的"流星火花"受击爆点。
    // 视觉构成：中心闪光（白核 + 黄绿光晕）+ 流星条（头粗尾尖、沿速度方向）+ 飘散光点。
    // 消散方式：从某个进度开始，整体粗细逐渐缩小 + 拖尾从尾端"被吃"到流星头（不是简单渐隐）。
    hitSparkSpeedMin: 14,         // 流星初速度下限（世界单位/秒；越大越"窜得远"）
    hitSparkSpeedMax: 26,         // 流星初速度上限
    hitSparkDrag: 1.6,            // 空气阻力（指数速度衰减系数；0=完全无衰减，越大越快变慢）
    hitSparkGravity: 9.0,         // 流星受到的下落重力（世界单位/秒²，模拟真实物理感）
    hitSparkConeAngle: 28,        // 喷射圆锥半角（度）。值越小越收束朝玩家；越大越发散
    hitSparkVerticalDamp: 0.55,   // 纵向（y）偏移阻尼（0=纯水平面，1=不抑制；防止流星朝地面/天上乱飞）
    hitSparkUpwardBias: 0.05,     // 起始 y 上扬偏移（>0 让流星整体略向上飞，平衡重力下坠）
    hitSparkLifetime: 0.45,       // 整体生命周期（秒）。越短越爆发、越长越拖泥带水
    hitSparkStreakCount: 14,      // 流星条数量（视觉密度）
    hitSparkEmberCount: 6,        // 飘散光点（embers）数量
    hitSparkThickness: 0.085,     // 流星头(粗端)半径基准（实例随机 ±25%）
    hitSparkLength: 1.0,          // 流星拖尾长度基准（实例随机 ±25%）
    hitSparkVanishStart: 0.55,    // 消散开始进度（0~1）。从此进度开始整体缩小并从尾巴吃到头
    // 方向反转开关：
    //   false（默认）= 火花朝武器入射方向的反方向飞溅（即朝玩家方向飞回来，原始效果）
    //   true        = 火花朝武器入射方向的正方向飞溅（即沿武器前进方向继续飞，朝敌人身后）
    hitSparkReverseDir: true,

    // ===== 主动攻击 · 出手瞬间流星火花特效（AttackSparkEffect / 复用 HitSparkEffect） =====
    // 玩家投出武器的瞬间，在玩家出手点生成的"流星火花"爆点。
    // 与"敌人受击流星火花"使用同一套渲染管线（HitSparkEffect），但参数完全独立。
    // 默认参数 = 与"敌人受击流星火花"一致（参考 arrow_config_1776913826436.json 的 hitSpark 缺省值，
    // 即沿用 config.js 默认）。可按需独立调节。
    attackSparkEnabled: true,     // 总开关
    // 方向反转开关：
    //   false（默认）= 火花朝玩家攻击方向的反方向飞溅（即朝玩家身后飞）
    //   true        = 火花朝玩家攻击方向的正方向飞溅（即朝敌人方向飞）
    attackSparkReverseDir: false,
    attackSparkSpeedMin: 14,
    attackSparkSpeedMax: 26,
    attackSparkDrag: 1.6,
    attackSparkGravity: 9.0,
    attackSparkConeAngle: 28,
    attackSparkVerticalDamp: 0.55,
    attackSparkUpwardBias: 0.05,
    attackSparkLifetime: 0.45,
    attackSparkStreakCount: 14,
    attackSparkEmberCount: 6,
    attackSparkThickness: 0.085,
    attackSparkLength: 1.0,
    attackSparkVanishStart: 0.55,
    attackSparkScale: 1.0,        // 出手瞬间整体缩放
    attackSparkScaleSpecial: 1.25, // 第4根特殊攻击的整体缩放

    // ===== 回收命中 · 爆体粒子特效（EnemyHitBurstEffect） =====
    // 玩家回收武器命中敌人时，从敌人身体中心爆发的两层粒子。
    // 第一层（Low*）：低位密集"爆体飞溅"，大量小粒子向四周喷洒、受重力下坠，
    //                颜色基于敌人本体色采样并加随机扰动，模拟身体被击碎飞散的碎屑/血肉/能量块。
    // 第二层（High*）：高位稀疏冲击粒子，数量更少但速度更快、向上偏置更强，飞到敌人头顶之上再落下，
    //                增强爆炸的层次感（不只是贴地散开）。
    // 共用：MeshBasicMaterial + 普通 alpha 透明（不开 Additive，让边缘自然柔和）。
    //
    // ★ 双端点参数化（与回收伤害数字一致的合并机制）：
    //     recallHitBurst*       → @1   单把武器命中（mergeCount = 1）使用
    //     recallHitBurst*AtMax  → @max 同帧合并 ≥ recallHitBurstCountForMax 把时使用
    //   命中数介于 1 和 CountForMax 之间时按 recallHitBurstCountCurve 插值。
    //   "合并"判定：同一逻辑帧 frameId 相同，或上次创建在 recallHitBurstMergeWindow 时间窗口内。
    //   合并发生时：旧特效"叠加"一批新粒子（新粒子按当前 mergeCount 插值出的参数生成），
    //                而不是销毁重建——所以会看到爆点"持续鼓起"，命中越多越夸张。
    recallHitBurstEnabled: true,        // 总开关
    recallHitBurstScale: 1.0,           // 整体缩放（同时影响位置散布和粒子大小）
    // 起爆点垂直偏移（从敌人 mesh.position 起，相对世界 y）。0 = 严格脚下，
    // 略高一点能让爆点贴在身体中段，看起来更像"被击中身体"
    recallHitBurstOriginY: 0.4,
    // 颜色采样源：'enemy' = 用敌人 bodyMat.userData.baseColor；'fixed' = 用 recallHitBurstFixedColor
    // 实际取色后会按 ColorJitter 做色相/明度随机扰动
    recallHitBurstColorSource: 'enemy', // 'enemy' | 'fixed'
    recallHitBurstFixedColor: 0x5e55a2, // ColorSource='fixed' 时使用的固定色

    // ---- 合并机制 ----
    // 时间窗口（秒）：上次粒子特效创建后多久内的命中仍可合并到同一特效。0 = 仅同帧合并。
    // 默认 0.05s ≈ 3 帧 (60fps)，与 dmgRecMergeWindow 数值一致但独立可调。
    recallHitBurstMergeWindow: 0.05,
    // 触发"@max"端点（最极端表现）所需的最低同时命中数。
    // 例：10 表示 10 把及以上同时命中时达到 *AtMax 端点；介于 1~10 间按曲线插值。
    recallHitBurstCountForMax: 10,
    // 1→CountForMax 之间的插值曲线类型（与 dmgRecCountCurve 同义）：
    //   0 = linear  1 = smoothstep（默认）  2 = smootherstep  3 = easeOutQuad
    recallHitBurstCountCurve: 0,        // 默认线性（用户偏好）

    // ---- 曲线模式（方案 B：3 根语义曲线整合 52 个 *AtMax 参数）----
    // 启用后，所有 *AtMax 参数被忽略，改由下方 3 根曲线驱动：
    //   density（数量与寿命）→ Count, LifeMin, LifeMax
    //   motion（运动强度）   → Speed*, UpBias, Gravity, Drag
    //   visual（视觉强度）   → Size*, Opacity, ColorJitter, Spin
    // 每根曲线模型：
    //   final = baseValue * lerp(startScale, endScale, cubicBezier(p1, p2, t))
    //   t = (mergeCount - 1) / (CountForMax - 1)，∈ [0, 1]
    //   baseValue = recallHitBurst<Layer><Suffix>（即原 @1 端点参数）
    // 默认 endScale 来自原 @max/@1 实测放大率：Count×3.04，Speed/Size×1.6~1.75，Opacity×1.3
    recallHitBurstUseCurves: true,
    recallHitBurstCurves: {
        density: {
            enabled: true,
            startScale: 1.0,
            endScale: 3.0,                 // 数量类放大率 ≈ ×3
            p1: { x: 0.42, y: 0.0 },
            p2: { x: 0.58, y: 1.0 },       // 默认 smoothstep 形状
        },
        motion: {
            enabled: true,
            startScale: 1.0,
            endScale: 1.7,                 // 运动学放大率 ≈ ×1.7
            p1: { x: 0.25, y: 0.1 },
            p2: { x: 0.25, y: 1.0 },       // 默认 easeOut 形状（前期猛涨后期收）
        },
        visual: {
            enabled: true,
            startScale: 1.0,
            endScale: 1.6,                 // 视觉放大率 ≈ ×1.6
            p1: { x: 0.0, y: 0.0 },
            p2: { x: 1.0, y: 1.0 },        // 默认 linear 形状
        },
    },

    // ---- 第一层：低位密集爆散粒子 ----（每行：@1 端点 / @max 端点）
    recallHitBurstLowCount:        26,    recallHitBurstLowCountAtMax:        80,    // 粒子数量
    recallHitBurstLowSpeedMin:     3.0,   recallHitBurstLowSpeedMinAtMax:     5.0,   // 初速度下限
    recallHitBurstLowSpeedMax:     8.0,   recallHitBurstLowSpeedMaxAtMax:     14.0,  // 初速度上限
    recallHitBurstLowUpBias:       0.25,  recallHitBurstLowUpBiasAtMax:       0.4,   // 上抛偏置
    recallHitBurstLowGravity:      18.0,  recallHitBurstLowGravityAtMax:      18.0,  // 重力（一般保持）
    recallHitBurstLowLifeMin:      0.45,  recallHitBurstLowLifeMinAtMax:      0.6,   // 寿命下限
    recallHitBurstLowLifeMax:      0.85,  recallHitBurstLowLifeMaxAtMax:      1.1,   // 寿命上限
    recallHitBurstLowSizeMin:      0.06,  recallHitBurstLowSizeMinAtMax:      0.10,  // 大小下限
    recallHitBurstLowSizeMax:      0.16,  recallHitBurstLowSizeMaxAtMax:      0.26,  // 大小上限
    recallHitBurstLowOpacity:      0.85,  recallHitBurstLowOpacityAtMax:      0.95,  // 不透明度
    recallHitBurstLowColorJitter:  0.35,  recallHitBurstLowColorJitterAtMax:  0.5,   // 颜色随机度
    recallHitBurstLowSpin:         8,     recallHitBurstLowSpinAtMax:         12,    // 自转速度
    recallHitBurstLowDrag:         1.2,   recallHitBurstLowDragAtMax:         1.0,   // 空气阻力

    // ---- 第二层：高位稀疏冲击粒子 ----（每行：@1 端点 / @max 端点）
    recallHitBurstHighCount:        8,    recallHitBurstHighCountAtMax:        24,
    recallHitBurstHighSpeedMin:     7.0,  recallHitBurstHighSpeedMinAtMax:     11.0,
    recallHitBurstHighSpeedMax:     13.0, recallHitBurstHighSpeedMaxAtMax:     20.0,
    recallHitBurstHighUpBias:       0.75, recallHitBurstHighUpBiasAtMax:       0.85,
    recallHitBurstHighGravity:      22.0, recallHitBurstHighGravityAtMax:      22.0,
    recallHitBurstHighLifeMin:      0.7,  recallHitBurstHighLifeMinAtMax:      0.9,
    recallHitBurstHighLifeMax:      1.2,  recallHitBurstHighLifeMaxAtMax:      1.6,
    recallHitBurstHighSizeMin:      0.10, recallHitBurstHighSizeMinAtMax:      0.16,
    recallHitBurstHighSizeMax:      0.22, recallHitBurstHighSizeMaxAtMax:      0.36,
    recallHitBurstHighOpacity:      0.9,  recallHitBurstHighOpacityAtMax:      1.0,
    recallHitBurstHighColorJitter:  0.45, recallHitBurstHighColorJitterAtMax:  0.6,
    recallHitBurstHighSpin:         6,    recallHitBurstHighSpinAtMax:         10,
    recallHitBurstHighDrag:         0.5,  recallHitBurstHighDragAtMax:         0.4,

    // ===== 敌人死亡 · 刀光闪现特效（SlashFlashEffect） =====
    // 敌人死亡瞬间，从死亡位置贴地（xz 平面）爆开的双层"刀光":
    //   外层 glow（粗、半透）+ 内层 core（细、几乎不透），AdditiveBlending 高光质感。
    // 朝向：沿击杀来向（direction）水平摆放；x 方向先"出鞘"展开，y 方向膨胀回收，最后整体淡出。
    // 全部参数在创建瞬间快照到实例，调参不影响已在播放的旧实例。
    slashFlashDuration:        0.18,    // 总时长（秒）；同时决定整段动画时间
    slashFlashLength:          3.1,     // 刀光长度（基准）；实际渲染长度 = 该值 × scale（一般 = enemyScale）
    slashFlashGlowWidth:       0.34,    // 外层光晕厚度（最大鼓肚处的总宽，xy 平面短轴方向）
    slashFlashCoreWidth:       0.12,    // 内层核心厚度（同上，更细）
    slashFlashCoreLengthRatio: 0.96,    // 内层核心相对外层的长度比例（<1 让核心比光晕略短，露出两端柔光）
    slashFlashHeightOffset:    0.55,    // 贴地高度偏移（从敌人 mesh.position.y 起算，受 scale 影响）
    slashFlashColor:           0x91c53a,// 颜色（默认黄绿，与玩家受击眼色一致）
    slashFlashGlowOpacity:     0.82,    // 外层光晕基准不透明度（淡出时按时间衰减）
    slashFlashCoreOpacity:     1.0,     // 内层核心基准不透明度
    slashFlashRevealRatio:     0.28,    // "出鞘"展开占总进度的比例（0~1）。值小 = 展开更快更利落；值大 = 拖出感更强
    slashFlashFadeStart:       0.55,    // 淡出起点（0~1 进度）。值越大整体可视时间越长，但末段会更急促

    damageTextScale: 1.0,
    hudScale: 1.0,
    // ===== 震动 · 穿刺事件（主动攻击飞行穿刺 + 回收穿刺，各自独立）=====
    // 主动攻击穿刺（羽毛飞行中命中敌人）
    shakeIntensityThrow: 0.08,          // 投掷穿刺·普通（前三根）强度
    shakeDurationThrow: 0.08,           // 投掷穿刺·普通（前三根）时长（秒）
    shakeIntensityThrowSpecial: 0.20,   // 投掷穿刺·特殊（第4根）强度
    shakeDurationThrowSpecial: 0.12,    // 投掷穿刺·特殊（第4根）时长（秒）
    // 回收穿刺（羽毛飞回途中命中敌人）
    shakeIntensityRecall: 0.1,          // 回收穿刺·普通（前三根）强度
    shakeDurationRecall: 0.10,          // 回收穿刺·普通（前三根）时长（秒）
    shakeIntensityFinal: 0.8,           // 回收穿刺·特殊（第4根）强度
    shakeDurationFinal: 0.15,           // 回收穿刺·特殊（第4根）时长（秒）
    // 其他（敌人死亡等通用）
    shakeIntensityDeath: 0.4,           // 敌人死亡震动强度
    shakeDuration: 0.15,                // 敌人死亡震动时长（秒） / 通用兜底
    hapticEnabled: true,
    hapticIntensity: 1.0,
    bloodLinger: 5.0,
    wallSlideBaseMultiplier: 0.3,
    wallSlideAngleMultiplier: 0.7,
    // [DEPRECATED 兼容字段] 旧版"对称"上下死区。新代码请改用
    // cameraDeadZoneTop / cameraDeadZoneBottom；当这两个新字段未定义时
    // 会回退使用本字段，保证旧预设 JSON 仍可正常加载。
    cameraVerticalDeadZone: 6.0,
    // 镜头跟随的"上死区"：玩家在世界 +Z 方向（屏幕上方）越过
    //   maxPlayerOffset - cameraDeadZoneTop
    // 之后镜头停止继续上移，让玩家自己向上靠近屏幕边缘。
    // 单位：世界单位。值越大，镜头停得越早，玩家上方可见空间越多。
    cameraDeadZoneTop: 6.0,
    // 镜头跟随的"下死区"：作用于世界 -Z 方向（屏幕下方），
    // 与 cameraDeadZoneTop 对称但相互独立。
    cameraDeadZoneBottom: 6.0,
    audioEnabled: true,
    audioVolume: 0.42,
    playerBounce: 0.18,
    runArmSpread: 0.3,
    runArmSwing: 0.8,
    runBodyUpShake: 0.15,
    runBodySway: 0.15,
    runBodyTwist: 0.15,
    runStepFreq: 2.5,
    runLegSwingForward: 1.1,
    runLegSwingBackward: 0.6,
    runBurst: 0.2,
    tailRadius: 0.04,
    tailSegLength: 0.07,
    hideVisualDistractors: false,
    showCombatTexts: true,
    showPlayerBaseRing: true,
    // 脚底武器环背景圆盘（淡紫色底盘）的基础半径。
    // 实际渲染半径 = baseRingBgRadius * 0.95，与原硬编码 0.45 一致。
    baseRingBgRadius: 0.45,
    baseRingArcOuterR: 0.35,
    baseRingArcThickness: 0.035,
    baseRingInnerRingOuterR: 0.24,
    baseRingInnerRingThickness: 0.065,
    baseRingFadeDuration: 0.25,

    // ===== 伤害数字 · 力量迸发动效（两组独立）=====
    // 说明：主动攻击（发射命中 = damageType 'low'）走 dmgAtk* 前缀，
    //       回收命中（damageType 'high' / 'special' / 中断回收文本）走 dmgRec* 前缀。
    //       damageTextScale / showCombatTexts 保持全局共享。

    // --- 主动攻击组（Attack）---
    // 三段动效：移动段 (MoveTimeRatio) → 驻留段 (HoldRatio) → 淡出段 (FadeRatio)
    // 缩放过渡：ScaleStart → ScalePunch → ScaleHold → ScaleEnd
    //   - ScaleStart：刚生成时的初始缩放（0 = 从一个点弹出，>0 = 已经具备一定大小再冲）
    //   - ScalePunch：移动段终点（最远位置）抵达瞬间的峰值缩放
    //   - ScaleHold ：驻留段结束时的稳定缩放
    //   - ScaleEnd  ：淡出段结束时的最终缩放
    dmgAtkMoveTimeRatio: 0.2,
    dmgAtkHoldRatio: 0.12,
    dmgAtkFadeRatio: 0.05,
    dmgAtkLife: 1.0,
    dmgAtkBurstDistMin: 3.8,
    dmgAtkBurstDistMax: 5.8,
    dmgAtkBurstUpMin: 0,
    dmgAtkBurstUpMax: 0,
    // 摇摆角度三点插值：Start → Mid → End
    //   生命周期前半段从 Start 过渡到 Mid，后半段从 Mid 过渡到 End。
    //   全程不再 sin 摆动，只做一次性平滑过渡，最后停在 End。
    dmgAtkShakeAmpStart: 23,
    dmgAtkShakeAmpMid: 12.75,
    dmgAtkShakeAmpEnd: 2.5,
    // ShakeAppearCurve：作用于"出现段"（Start → Mid）的曲线指数（>=1）。
    //   公式：1 - pow(1 - p, curve)，ease-out 先快后慢。
    //   1.0 = 线性匀速；2.0 = 温和先快后慢；3.0 = 明显先快后慢（推荐，
    //   出现瞬间角度立刻甩出去，再缓缓贴近 Mid）。
    dmgAtkShakeAppearCurve: 3.0,
    // ShakeEndCurve：作用于"消失段"（Mid → End）的曲线指数（>=1）。
    //   公式：pow(p, curve)，ease-in 先慢后急。
    //   1.0 = 线性匀速；2.0 = 温和先慢后快；3.0 = 明显先慢后快（推荐，
    //   贴 Mid 飘移，临近结束时利落归位 End）。
    dmgAtkShakeEndCurve: 3.0,
    dmgAtkScaleStart: 0,
    dmgAtkScalePunch: 2.4,
    dmgAtkScaleHold: 2.2,
    dmgAtkScaleEnd: 2.0,
    dmgAtkDirJitterDeg: 0,

    // --- 主动攻击组 · 逐字"从天而降"动效（不区分 @1/@max；与回收组同款机制） ---
    // 字符按累加 Gap 顺序依次出现；出现瞬间 scale = Peak（由大亮相），
    // 然后在 Dur 时长内 easeOutCubic 衰减到 1.0 稳定。未到出现时刻 scale=0（占位不可见）。
    //
    // 字符越靠后：间隔越大（出现节奏变慢）+ 衰减时长越长（落地越软）+ 初始 Peak 越大
    // —— 视觉上"前轻后重"，最后一个字以最大尺寸"砸"下来再快速落定。
    //
    // 双端点：Start = 第一个字符使用，End = 最后一个字符使用，中间线性插值。
    //   - 启用开关：dmgAtkCharStaggerEnabled (1/0)
    //   - 字符间隔：dmgAtkCharGapStart  → dmgAtkCharGapEnd  （秒；越大出现得越慢）
    //   - 衰减时长：dmgAtkCharDurStart  → dmgAtkCharDurEnd  （秒；从 Peak 落到 1 的耗时）
    //   - 初始缩放：dmgAtkCharPeakStart → dmgAtkCharPeakEnd （>1 = 由大；前小后大体现"前轻后重"）
    // 注：主动攻击不合并，每次独立跳字。
    dmgAtkCharStaggerEnabled: 1,
    dmgAtkCharGapStart:  0.04,
    dmgAtkCharGapEnd:    0.10,
    dmgAtkCharDurStart:  0.18,
    dmgAtkCharDurEnd:    0.40,
    dmgAtkCharPeakStart: 1.4,
    dmgAtkCharPeakEnd:   2.4,

    // --- 回收命中组（Recall；含 high / special / 中断回收）---
    //
    // ★ 双端点参数化：每个动效参数都有两个值
    //     dmgRec*        → @1   单把武器命中（mergeCount = 1）时使用
    //     dmgRec*AtMax   → @max 同帧合并 ≥ dmgRecCountForMax 把时使用
    //   合并次数介于 1 和 CountForMax 之间时按 dmgRecCountCurve 插值。
    //   旧 preset 中只有单值的，自动等同于 @1 = @max（即关闭命中数加成）。
    //
    // 注意：dmgRecBurstDistMin/Max 和 dmgRecBurstUpMin/Max 这里的 Min/Max
    //       表示"随机散布范围"，与"双端点"的 Max 含义不同。所以双端点用
    //       后缀 AtMax，例如 dmgRecBurstDistMinAtMax = "@max 端点的散布下限"。
    dmgRecMoveTimeRatio: 0.2,        dmgRecMoveTimeRatioAtMax: 0.2,
    dmgRecHoldRatio: 0.12,           dmgRecHoldRatioAtMax: 0.12,
    dmgRecFadeRatio: 0.05,           dmgRecFadeRatioAtMax: 0.05,
    dmgRecLife: 1.0,                 dmgRecLifeAtMax: 1.6,
    dmgRecBurstDistMin: 3.8,         dmgRecBurstDistMinAtMax: 3.8,
    dmgRecBurstDistMax: 5.8,         dmgRecBurstDistMaxAtMax: 5.8,
    dmgRecBurstUpMin: 0,             dmgRecBurstUpMinAtMax: 0,
    dmgRecBurstUpMax: 0,             dmgRecBurstUpMaxAtMax: 0,
    // 摇摆角度三点插值：Start → Mid → End（详见 dmgAtkShakeAmpStart 注释）
    dmgRecShakeAmpStart: 23,         dmgRecShakeAmpStartAtMax: 35,
    dmgRecShakeAmpMid: 12.75,        dmgRecShakeAmpMidAtMax: 18.75,
    dmgRecShakeAmpEnd: 2.5,          dmgRecShakeAmpEndAtMax: 2.5,
    // 出现段曲线指数（详见 dmgAtkShakeAppearCurve 注释）
    dmgRecShakeAppearCurve: 3.0,     dmgRecShakeAppearCurveAtMax: 3.0,
    // 消失段曲线指数（详见 dmgAtkShakeEndCurve 注释）
    dmgRecShakeEndCurve: 3.0,        dmgRecShakeEndCurveAtMax: 3.0,
    dmgRecScaleStart: 0,             dmgRecScaleStartAtMax: 0,
    dmgRecScalePunch: 2.4,           dmgRecScalePunchAtMax: 3.6,
    dmgRecScaleHold: 2.2,            dmgRecScaleHoldAtMax: 3.2,
    dmgRecScaleEnd: 2.0,             dmgRecScaleEndAtMax: 2.8,
    dmgRecDirJitterDeg: 0,           dmgRecDirJitterDegAtMax: 0,
    // 仅回收组有：无方向 fallback 时的向上位移（中断回收文本用）
    dmgRecFallbackUp: 0,             dmgRecFallbackUpAtMax: 0,

    // ===== 逐字"从天而降"动效（仅回收组；不区分 @1/@max）=====
    // 字符按累加 Gap 顺序依次出现；出现瞬间 scale = Peak（由大亮相），
    // 然后在 Dur 时长内 easeOutCubic 衰减到 1.0 稳定。未到出现时刻 scale=0（占位不可见）。
    //
    // 字符越靠后：间隔越大（出现节奏变慢）+ 衰减时长越长（落地越软）+ 初始 Peak 越大
    // —— 视觉上"前轻后重"，最后一个字以最大尺寸"砸"下来再快速落定。
    //
    // 双端点：Start = 第一个字符使用，End = 最后一个字符使用，中间线性插值。
    //   - 启用开关：dmgRecCharStaggerEnabled (1/0)
    //   - 字符间隔：dmgRecCharGapStart  → dmgRecCharGapEnd  （秒；越大出现得越慢）
    //   - 衰减时长：dmgRecCharDurStart  → dmgRecCharDurEnd  （秒；从 Peak 落到 1 的耗时）
    //   - 初始缩放：dmgRecCharPeakStart → dmgRecCharPeakEnd （>1 = 由大；前小后大体现"前轻后重"）
    // 注：合并"X3贯穿"时整条文本重置重播一遍出现序列。
    dmgRecCharStaggerEnabled: 1,
    dmgRecCharGapStart:  0.04,
    dmgRecCharGapEnd:    0.10,
    dmgRecCharDurStart:  0.18,
    dmgRecCharDurEnd:    0.40,
    dmgRecCharPeakStart: 1.4,
    dmgRecCharPeakEnd:   2.4,

    // 多把武器"同时击中"同一敌人时合并为一个跳字 (-10 ×N贯穿) 的时间窗口（秒）。
    // 实际合并条件：同一逻辑帧 OR 上次跳字距今 ≤ dmgRecMergeWindow。
    // 设为 0 时仅同帧合并；调大则更宽容（例如低帧率/抖动场景），但跨轮回收也可能被合并。
    // ★ 此参数同时控制"濒死缓冲期"时长（lethal grace window）：
    //    当回收命中 (high/special) 把敌人 hp 打到 ≤0 时，敌人不立即 die()，而是进入
    //    濒死缓冲期，期间继续吸收后续武器的命中（用于伤害数字与爆体特效合并），
    //    缓冲结束（计时器归零或下一次主动攻击命中）才真正死亡。
    //    这样多把武器低血量斩杀时也能完整呈现 240 ×5贯穿 的爽感。
    dmgRecMergeWindow: 0.05,
    // 触发"@max"动效（最极端尺寸/寿命）所需的最低同时命中数。
    // 例如 10 表示 10 把及以上武器同时命中时达到 dmgRec*AtMax 端点；介于 1~10 间按曲线插值。
    dmgRecCountForMax: 10,
    // 1→CountForMax 之间的插值曲线类型：
    //   0 = linear         （线性）
    //   1 = smoothstep     （3t²-2t³，默认；起止平滑）
    //   2 = smootherstep   （6t⁵-15t⁴+10t³，更平滑）
    //   3 = easeOutQuad    （1-(1-t)²，前期变化快后期收敛）
    dmgRecCountCurve: 1,
    joystickVisualOffset: 25,
    joystickDeadZone: 3,
    joystickLockRadius: 15,
    joystickFastTraverseMs: 100,
    joystickSmoothFactor: 0.35,
    modelTiltAngle: 0,
    modelHeightOffset: 0,
    // 调节面板本身的透明度 (0.1 ~ 1.0)
    panelOpacity: 1.0,
    // 禁用玩家攻击（调试/演示用）。开启后玩家不再触发羽毛投掷
    playerAttackDisabled: false,
    // 禁用第 4 下特殊攻击循环。开启后所有投掷都按普通攻击处理。
    disableSpecialAttackCycle: false,

    // 站立时身体的呼吸微动（攻击间隙 / 完全静止时叠加在 bodyGroup.y 上）
    idleBodyShakeY: 0.03,      // 呼吸幅度
    idleBodyShakeSpeed: 3.0,   // 呼吸频率

    // =====================================================================
    // 标枪特效参数 (Javelin VFX) —— 4 个发射器（Emitter）独立参数
    // =====================================================================

    // ---- 1. 核心抛射体 (Projectile Core) ----
    vfxCoreIntensity: 12.0,        // HDR 自发光强度
    vfxCoreScaleX: 0.25,           // 横向截面（厚度）
    vfxCoreScaleY: 0.25,           // 纵向截面（厚度）
    vfxCoreScaleZ: 2.5,            // 沿飞行方向长度（拉伸为长矛）
    vfxCoreFresnelPow: 1.5,        // 中心->边缘的过渡硬度
    vfxCoreColor: 0xffffff,        // 中心颜色
    vfxCoreEdgeColor: 0xffcc00,    // 边缘颜色
    vfxCoreFadeDuration: 0.18,     // 分离后核心淡出时间（秒）

    // ---- 1b. 飞行武器实体模型 (Flight Weapon Model) ----
    // 武器在飞行 (shooting) 阶段叠加在 baseModelScale 之上的额外缩放倍率，
    // 仅影响飞行期间的实体三叉戟模型外观；落地后恢复为 baseModelScale，
    // 不影响蓄力时手上的模型 (attackHeldWeaponScale) 与召回阶段的缩小动画。
    vfxFlightModelScale: 1.0,

    // ---- 2. 音障环 / 冲击波 (Mach Rings) ----
    vfxRingSpawnDist: 1.5,         // 每飞行多远生成一个环
    vfxRingLife: 0.25,             // 环存活时间（秒）
    vfxRingStartScale: 0.2,        // 起始缩放
    vfxRingEndScale: 2.0,          // 终末缩放
    vfxRingInheritVel: -0.15,      // 跟随飞行方向的继承速度倍率（负数=向后漂）
    vfxRingColor: 0xffd820,        // 颜色
    vfxRingIntensity: 8.0,         // HDR 强度
    vfxRingInner: 0.42,            // 环的内径(0~0.5)
    vfxRingOuter: 0.5,             // 环的外径(0~0.5)
    vfxRingSoftness: 0.05,         // 边缘羽化

    // ---- 3. 核心拖尾 (Ribbon Trail) ----
    vfxTrailLength: 30,            // 最大节点数（更长=更长尾巴）
    vfxTrailWidth: 0.4,            // 头部宽度（武器侧）
    vfxTrailTailWidth: 0.0,        // 尾部宽度（衰减为 0）
    vfxTrailIntensity: 8.0,        // HDR 强度
    vfxTrailColorHead: 0xffff99,   // 头部颜色
    vfxTrailColorTail: 0xff6600,   // 尾部颜色
    vfxTrailNoiseScale: 20.0,      // 噪波频率（越大边缘越细碎）
    vfxTrailNoiseSpeed: 10.0,      // 噪波滚动速度（拉丝感）
    vfxTrailNoiseAmount: 0.4,      // 噪波侵蚀强度
    vfxTrailEdgeSoftness: 0.6,     // 中心硬度（越大主体越宽）
    vfxTrailFadeDuration: 0.6,     // 分离后整个尾巴淡出时间

    // ---- 4. 飞溅粒子 (Sparks / Debris) ----
    vfxSparkSpawnDist: 0.4,        // 每飞行多远尝试生成一次火花
    vfxSparkProb: 0.7,             // 在每个生成点的命中概率
    vfxSparkLife: 0.18,            // 火花寿命
    vfxSparkBaseSpeed: 3.0,        // 火花基础速度
    vfxSparkSpeedRand: 5.0,        // 火花随机速度上限
    vfxSparkSpeed: 1.0,            // 全局速度倍率
    vfxSparkInheritVel: 0.3,       // 继承武器速度倍率
    vfxSparkConeAngle: 35,         // 锥形发射半角(度)
    vfxSparkDrag: 0.9,             // 空气阻力（越接近1越保留速度）
    vfxSparkGravity: -2.0,         // 重力加速度
    vfxSparkSize: 0.5,             // 横向尺寸
    vfxSparkStretch: 0.2,          // 速度方向上的拉伸系数
    vfxSparkColor: 0xffdd44,       // 颜色
    vfxSparkFlickerLow: 0.5,       // 闪烁的最低 alpha

    // ===== 地图配置 =====
    mapBrickCountX: 6.0,          // 砖块横向数量
    mapBrickAspectY: 1.0,         // 砖块纵向比例 (高度占宽度的比例; 1.0 = 正方形)
    mapGapWidth: 0.02,            // 缝隙宽度
    mapStaggerOffset: 0.5,        // 交错偏移量(0-1)
    mapBrickOpacity: 1.0,             // 砖块整体透明度(0-1)
    mapBrickColorStart: 0x312c5c,     // 渐变起始色（角度方向上的起点）
    mapBrickColorMid: 0x6f5fa0,       // 渐变中间色（位于 mapBrickColorMidPos 处）
    mapBrickColorMidPos: 0.5,         // 中间色位置（0-1，0.5=正中）
    mapBrickColorEnd: 0x91c53a,       // 渐变结束色（角度方向上的终点）
    mapBrickGradientAngle: 135,       // 渐变方向角度（度）。0=左→右, 90=上→下, 135=左上→右下
    mapBrickGradientCycles: 1.0,      // 渐变周期数（1=单次, 2=两个完整周期, 0.5=只走一半…）
    mapBrickGapColor: 0x110f22,       // 砖缝颜色
    mapBrickBaseColor: 0x2d2952,      // 砖块下方衬底颜色（仅 brick 模式生效）
    mapBrickBaseOpacity: 1.0,         // 砖块下方衬底透明度(0-1)
};

// 三层叠加（前者优先级低、被后者覆盖）：
//   DEFAULT_CONFIG  ←  SHIPPING_PRESET  ←  localStorage（在文件末尾再叠加）
// 这里先合并出厂 preset，使 APK 首启没有 localStorage 时也能呈现出厂调好的参数。
export const CONFIG = { ...DEFAULT_CONFIG, ...SHIPPING_PRESET };

/**
 * 迁移"伤害数字"的旧版字段到新版双组字段。
 * 旧版：dmgBurstRatio / dmgHoldRatio / ... 单一组
 * 新版：dmgAtkBurstRatio / dmgRecBurstRatio ... 主动攻击 + 回收命中双组
 *
 * 规则：检测到旧键存在，就同时填充 dmgAtk* 和 dmgRec*（两组初始相同），
 *       最后删除旧键。对于 dmgFallbackUp，仅迁移到 dmgRecFallbackUp。
 *
 * 就地修改 targetConfig，适用于 localStorage 持久化配置和 preset 加载两种场景。
 */
export function migrateDamageTextConfig(targetConfig) {
    // ---- 第一代：单组 → 双组（dmg*  →  dmgAtk* / dmgRec*）----
    // 注意：dmgBurstRatio 最终目标是新名 dmgAtkMoveTimeRatio / dmgRecMoveTimeRatio
    //       （而不是已废弃的 dmgAtkBurstRatio）
    const sharedMap = {
        dmgBurstRatio:    ['dmgAtkMoveTimeRatio', 'dmgRecMoveTimeRatio'],
        dmgHoldRatio:     ['dmgAtkHoldRatio',     'dmgRecHoldRatio'],
        dmgFadeRatio:     ['dmgAtkFadeRatio',     'dmgRecFadeRatio'],
        dmgLife:          ['dmgAtkLife',          'dmgRecLife'],
        dmgBurstDistMin:  ['dmgAtkBurstDistMin',  'dmgRecBurstDistMin'],
        dmgBurstDistMax:  ['dmgAtkBurstDistMax',  'dmgRecBurstDistMax'],
        dmgBurstUpMin:    ['dmgAtkBurstUpMin',    'dmgRecBurstUpMin'],
        dmgBurstUpMax:    ['dmgAtkBurstUpMax',    'dmgRecBurstUpMax'],
        dmgShakeAmpStart: ['dmgAtkShakeAmpStart', 'dmgRecShakeAmpStart'],
        dmgShakeAmpMid:   ['dmgAtkShakeAmpMid',   'dmgRecShakeAmpMid'],
        dmgShakeAmpEnd:      ['dmgAtkShakeAmpEnd',      'dmgRecShakeAmpEnd'],
        dmgShakeAppearCurve: ['dmgAtkShakeAppearCurve', 'dmgRecShakeAppearCurve'],
        dmgShakeEndCurve:    ['dmgAtkShakeEndCurve',    'dmgRecShakeEndCurve'],
        dmgScalePunch:    ['dmgAtkScalePunch',    'dmgRecScalePunch'],
        dmgScaleHold:     ['dmgAtkScaleHold',     'dmgRecScaleHold'],
        dmgScaleEnd:      ['dmgAtkScaleEnd',      'dmgRecScaleEnd'],
        dmgDirJitterDeg:  ['dmgAtkDirJitterDeg',  'dmgRecDirJitterDeg'],
    };
    const recallOnlyMap = {
        dmgFallbackUp: ['dmgRecFallbackUp'],
    };

    // ---- 第二代：BurstRatio → MoveTimeRatio（同一含义，更易理解的命名）----
    // 用户面板上"迸发冲程占比"概念过抽象，统一改名为"移动时间占比"。
    //
    // 同时迁移：attackInterruptThrowDelay → attackThrowSpawnDelay
    //   旧名强调"延后多久之后打断才算有效"，新名强调"延后多久才生成武器"。
    //   两者外部行为完全等价（蓄力结束 → T 秒延后 → spawn 武器 → 进入可打断
    //   后摇阶段），只是新名更符合玩家直觉：先看到武器生成飞出，再能打断。
    const renameMap = {
        dmgAtkBurstRatio:          'dmgAtkMoveTimeRatio',
        dmgRecBurstRatio:          'dmgRecMoveTimeRatio',
        dmgRecBurstRatioAtMax:     'dmgRecMoveTimeRatioAtMax',
        attackInterruptThrowDelay: 'attackThrowSpawnDelay',
    };

    const migrateOne = (map) => {
        for (const oldKey of Object.keys(map)) {
            if (targetConfig[oldKey] !== undefined) {
                for (const newKey of map[oldKey]) {
                    // 只有当新键不存在时才填充；若外部已显式设置新值则尊重之
                    if (targetConfig[newKey] === undefined) {
                        targetConfig[newKey] = targetConfig[oldKey];
                    }
                }
                delete targetConfig[oldKey];
            }
        }
    };
    migrateOne(sharedMap);
    migrateOne(recallOnlyMap);

    // 重命名：旧 key 直接 rename 到新 key（一对一）
    for (const [oldKey, newKey] of Object.entries(renameMap)) {
        if (targetConfig[oldKey] !== undefined) {
            if (targetConfig[newKey] === undefined) {
                targetConfig[newKey] = targetConfig[oldKey];
            }
            delete targetConfig[oldKey];
        }
    }

    // ---- 第三代清理：废弃的旧逐字进入参数（v1：固定 stagger/punchDur/from/to）----
    // 已被 v2 "Dock 波浪" 模型取代（GapStart/End、DurStart/End、PeakStart/End）。
    // 旧值无法直接迁移到新模型（含义不同），直接删除让新默认值生效。
    //
    // 同时清理已废弃的"摇摆频率"参数（v3 起不再支持 sin 摆动模式，改为
    // Start→Mid→End 三点一次性过渡）。
    const obsoleteKeys = [
        'dmgRecCharStagger',
        'dmgRecCharPunchDur',
        'dmgRecCharScaleFrom',
        'dmgRecCharScaleTo',
        'dmgAtkShakeFreq',
        'dmgRecShakeFreq',
        'dmgRecShakeFreqAtMax',
        // 受击反馈统一：木桩独立形变参数已合并到 hitDeform*，老 preset 中的字段无需保留
        // （木桩的形变现在直接读 hitDeform*，Radius 仅球形/柱状用到；老的 stakeHitDeformDent 概念被 hitDeformDepth 涵盖）
        'stakeHitDeformEnabled',
        'stakeHitDeformDepth',
        'stakeHitDeformDent',
        'stakeHitDeformStiffness',
        'stakeHitDeformDamping',
        'stakeHitDeformDuration',
        'stakeHitDeformSquash',
        // 受击形变升级到 Squash & Stretch 模型：
        //   旧 hitDeformDepth/Radius/Squash 三个参数被新的 hitDeformDent*/Squash*/Stretch* 取代。
        //   旧 preset 中这些字段直接删除即可（新默认值更适合"q弹多汁"手感）。
        //   如果用户希望保留老手感，可手动从 0.35/0.7/0.25 映射到 hitDeformDentDepth=0.35,
        //   hitDeformDentRadius=0.7, hitDeformSquashAxis=0.25——但通常新默认更好看。
        'hitDeformDepth',
        'hitDeformRadius',
        'hitDeformSquash',
    ];
    for (const k of obsoleteKeys) {
        if (targetConfig[k] !== undefined) delete targetConfig[k];
    }

    // 双端点参数迁移：对老 preset 而言只有 dmgRec* 单值（= @1 端点），缺失的
    // dmgRec*AtMax 应当等于 dmgRec*（即两端相同 = 关闭命中数加成），而不是用
    // DEFAULT_CONFIG 中的偏大值——否则用户加载老存档会发现"贯穿"时跳字突然变大。
    const dualKeys = [
        'dmgRecMoveTimeRatio', 'dmgRecHoldRatio', 'dmgRecFadeRatio',
        'dmgRecLife',
        'dmgRecBurstDistMin', 'dmgRecBurstDistMax',
        'dmgRecBurstUpMin', 'dmgRecBurstUpMax',
        'dmgRecShakeAmpStart', 'dmgRecShakeAmpMid', 'dmgRecShakeAmpEnd',
        'dmgRecShakeAppearCurve', 'dmgRecShakeEndCurve',
        'dmgRecScaleStart', 'dmgRecScalePunch', 'dmgRecScaleHold', 'dmgRecScaleEnd',
        'dmgRecDirJitterDeg',
        'dmgRecFallbackUp',
    ];
    for (const k of dualKeys) {
        const atMaxKey = k + 'AtMax';
        if (targetConfig[k] !== undefined && targetConfig[atMaxKey] === undefined) {
            targetConfig[atMaxKey] = targetConfig[k];
        }
    }

    // ---- 第四代：ShakeAmp 由两点（Start/End）扩展为三点（Start/Mid/End）----
    // 老 preset 没有 *ShakeAmpMid 字段。如果保留 DEFAULT_CONFIG 中的 12.75 作为
    // 兜底，会改变老 preset 的观感。智能策略：缺失时自动取 (Start + End) / 2，
    // 这样三点插值的轨迹近似两点线性插值，老存档加载后表现保持不变。
    const midPairs = [
        // [midKey, startKey, endKey]
        ['dmgAtkShakeAmpMid',      'dmgAtkShakeAmpStart',      'dmgAtkShakeAmpEnd'],
        ['dmgRecShakeAmpMid',      'dmgRecShakeAmpStart',      'dmgRecShakeAmpEnd'],
        ['dmgRecShakeAmpMidAtMax', 'dmgRecShakeAmpStartAtMax', 'dmgRecShakeAmpEndAtMax'],
    ];
    for (const [midKey, startKey, endKey] of midPairs) {
        if (targetConfig[midKey] === undefined
            && targetConfig[startKey] !== undefined
            && targetConfig[endKey] !== undefined) {
            targetConfig[midKey] = (targetConfig[startKey] + targetConfig[endKey]) / 2;
        }
    }

    return targetConfig;
}

// 对已合并的出厂参数（DEFAULT + SHIPPING）做一次旧字段迁移，
// 防止有人把仍带旧字段的 preset 贴进 shipping.js 时游戏内字段不生效。
migrateDamageTextConfig(CONFIG);

// Load from localStorage if available
// 注意：localStorage 在加载顺序里优先级最高，会覆盖 SHIPPING_PRESET。
// 这意味着开发者在面板里调过的参数仍然生效；普通用户从未动过面板时，
// localStorage 为空，CONFIG 就停留在 SHIPPING_PRESET 状态（出厂参数）。
try {
    const savedConfig = localStorage.getItem('arrowProjectConfig');
    if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        migrateDamageTextConfig(parsed); // 先迁移旧字段
        Object.assign(CONFIG, parsed);
    }
} catch (e) {
    console.error('Failed to load config from localStorage', e);
}
