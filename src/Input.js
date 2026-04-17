import { CONFIG } from './config.js';

export const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };
export const joystick = { x: 0, y: 0, isActive: false };

const DEFAULT_JOYSTICK_POS = { x: 0.5, y: 0.78 };
const JOYSTICK_IDLE_DELAY = 1000;
let activePointerId = null;
let wrapperEl = null;
let joystickEl = null;
let knobEl = null;
let arcEl = null;
let joystickVisualRadius = 39; // 视觉上摇杆能推到的最远边缘 (Base 半径 68 - Knob 半径 29)
let joystickLogicalRadius = 28; // 实际逻辑上推到满速 (1.0) 所需的滑动距离
let origin = { x: 0, y: 0 };
let isInsideDeadZone = true;              // 当前推子是否在死区内
let deadZoneEntryPoint = { x: 0, y: 0 }; // 进入死区时的坐标 (相对于 origin 的 dx/dy)
let deadZoneEntryTime = 0;                // 进入死区的时间戳 (ms)
let lockedAngle = null;                   // 锁定的意图角度
let isAngleLocked = false;                // 是否处于角度锁定状态
let isFastTraverse = false;               // 本次离开死区是否为快速穿越
let outputAngle = 0;                      // 实际输出给角色的角度（经过平滑过渡）
let hasOutputAngle = false;               // 是否已经有过有效的输出角度（用于区分首次起步）
let idleTimeoutId = null;

// 角度插值（走最短弧）
function lerpAngle(from, to, t) {
    let diff = to - from;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return from + diff * t;
}

export function initInput(wrapper) {
    wrapperEl = wrapper;
    joystickEl = document.getElementById('virtual-joystick');
    knobEl = document.getElementById('joystick-knob');
    arcEl = document.getElementById('joystick-arc');

    window.addEventListener('keydown', (e) => { if(keys.hasOwnProperty(e.key)) keys[e.key] = true; });
    window.addEventListener('keyup', (e) => { if(keys.hasOwnProperty(e.key)) keys[e.key] = false; });

    if (!wrapperEl || !joystickEl || !knobEl) return;

    placeJoystickAtDefault();
    scheduleIdleState();
    wrapperEl.addEventListener('pointerdown', handlePointerDown);
    wrapperEl.addEventListener('pointermove', handlePointerMove);
    wrapperEl.addEventListener('pointerup', handlePointerUp);
    wrapperEl.addEventListener('pointercancel', handlePointerUp);
}

export function refreshInputLayout() {
    if (!joystick.isActive) placeJoystickAtDefault();
}

function handlePointerDown(event) {
    if (activePointerId !== null) return;
    // Allow mouse events for testing purposes
    // if (event.pointerType === 'mouse') return;
    event.preventDefault();

    const rect = wrapperEl.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    if (localY < rect.height * 0.42) return;

    activePointerId = event.pointerId;
    wrapperEl.setPointerCapture(event.pointerId);
    joystick.isActive = true;
    isInsideDeadZone = true;
    deadZoneEntryPoint = { x: 0, y: 0 }; // 首次按下，进入点就是原点本身
    deadZoneEntryTime = performance.now();
    isAngleLocked = false;
    isFastTraverse = false;
    lockedAngle = null;
    outputAngle = 0;
    hasOutputAngle = false;
    markJoystickActive();
    joystickEl.classList.add('is-active');
    setJoystickOrigin(localX, localY);
    updateJoystick(localX, localY);
}

function handlePointerMove(event) {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    markJoystickActive();
    const rect = wrapperEl.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    updateJoystick(localX, localY);
}

function handlePointerUp(event) {
    if (event.pointerId !== activePointerId) return;

    if (wrapperEl.hasPointerCapture(event.pointerId)) {
        wrapperEl.releasePointerCapture(event.pointerId);
    }
    activePointerId = null;
    joystick.x = 0;
    joystick.y = 0;
    isInsideDeadZone = true;
    deadZoneEntryPoint = { x: 0, y: 0 };
    deadZoneEntryTime = 0;
    isAngleLocked = false;
    isFastTraverse = false;
    lockedAngle = null;
    outputAngle = 0;
    hasOutputAngle = false;
    joystick.isActive = false;
    knobEl.style.transform = 'translate(-50%, -50%)';
    if (arcEl) arcEl.classList.remove('is-visible');
    placeJoystickAtDefault();
    joystickEl.classList.remove('is-active');
    scheduleIdleState();
}

function updateJoystick(localX, localY) {
    const dx = localX - origin.x;
    const dy = localY - origin.y;
    const distance = Math.hypot(dx, dy);
    
    // 视觉UI部分：保持绝对跟手
    const visualDistance = Math.min(distance, joystickVisualRadius);
    const rawAngle = Math.atan2(dy, dx);
    const knobX = Math.cos(rawAngle) * visualDistance;
    const knobY = Math.sin(rawAngle) * visualDistance;
    knobEl.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;

    // 方向弧形指示器：在外围画四分之一圆环指示推子方向
    if (arcEl) {
        if (distance > 3) {
            // atan2 坐标系：0=右, 正=顺时针(屏幕)  CSS坐标系：0=上, 正=顺时针
            // 转换：CSS角度 = atan2角度(度) + 90°
            const arcCssDeg = rawAngle * (180 / Math.PI) + 90;
            arcEl.style.transform = `rotate(${arcCssDeg}deg)`;
            arcEl.classList.add('is-visible');
        } else {
            arcEl.classList.remove('is-visible');
        }
    }

    // --- 意图检测系统：基于死区轨迹的方向锁定 ---
    const DEAD_ZONE = CONFIG.joystickDeadZone ?? 3;              // 死区半径 (像素)
    const LOCK_RADIUS = CONFIG.joystickLockRadius ?? 15;         // 在此半径内保持锁定方向
    const UNLOCK_ANGLE_DIFF = Math.PI / 3;                          // 60度，超过则认为玩家主动换方向
    const FAST_TRAVERSE_MS = CONFIG.joystickFastTraverseMs ?? 100;   // 快速穿越阈值 (ms)
    const SMOOTH_FACTOR = CONFIG.joystickSmoothFactor ?? 0.35;       // 慢速穿越时的角度平滑系数

    if (distance <= DEAD_ZONE) {
        // ——— 当前在死区内 ———
        if (!isInsideDeadZone) {
            // 刚从外面滑进死区：记录进入点和时间
            deadZoneEntryPoint = { x: dx, y: dy };
            deadZoneEntryTime = performance.now();
            isInsideDeadZone = true;
        }
        // 保持 joystick.x/y 和 outputAngle 不变（惯性续航）
        // 首次按下时 joystick.x/y 已在 handlePointerDown 中初始化为 0
    } else {
        // ——— 当前在死区外 ———
        if (isInsideDeadZone) {
            // 刚从死区出来！用 entryPoint → exitPoint 向量计算意图方向
            const exitX = dx;
            const exitY = dy;
            const traverseDx = exitX - deadZoneEntryPoint.x;
            const traverseDy = exitY - deadZoneEntryPoint.y;
            const traverseDist = Math.hypot(traverseDx, traverseDy);

            if (traverseDist > 0.5) {
                lockedAngle = Math.atan2(traverseDy, traverseDx);
            } else {
                lockedAngle = rawAngle;
            }
            isAngleLocked = true;
            isInsideDeadZone = false;

            // 根据在死区内停留的时间判断：快速划过 vs 慢速微操
            const traverseTime = performance.now() - deadZoneEntryTime;
            isFastTraverse = (traverseTime < FAST_TRAVERSE_MS);
        }

        // 确定目标角度 + 输出（三条路径）
        if (isAngleLocked && !isFastTraverse) {
            // 路径1：经过了死区 且 慢速穿越 → 锁定方向 + 平滑过渡
            let finalAngle = lockedAngle;

            if (distance > LOCK_RADIUS) {
                isAngleLocked = false;
                finalAngle = rawAngle;
            } else {
                let angleDiff = Math.abs(rawAngle - lockedAngle);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

                if (angleDiff > UNLOCK_ANGLE_DIFF) {
                    isAngleLocked = false;
                    finalAngle = rawAngle;
                }
            }

            if (!hasOutputAngle) {
                outputAngle = finalAngle;
                hasOutputAngle = true;
            } else {
                outputAngle = lerpAngle(outputAngle, finalAngle, SMOOTH_FACTOR);
            }
        } else {
            // 路径2：经过了死区但快速穿越 → 直接跳转
            // 路径3：没经过死区（跳过了）或锁定已解除 → 直接跟随 rawAngle
            if (isAngleLocked && isFastTraverse) {
                // 快速穿越：用锁定角度（entry→exit轨迹）直接跳转，然后立刻解除锁定
                outputAngle = lockedAngle;
                isAngleLocked = false;
                isFastTraverse = false;
            } else {
                outputAngle = rawAngle;
            }
            hasOutputAngle = true;
        }

        // 计算速度强度
        let rawIntensity = (distance - DEAD_ZONE) / joystickLogicalRadius;
        const maxIndicatorIntensity = 1.8;
        rawIntensity = Math.min(rawIntensity, maxIndicatorIntensity);

        joystick.x = Math.cos(outputAngle) * rawIntensity;
        joystick.y = Math.sin(outputAngle) * rawIntensity;
    }
}

function placeJoystickAtDefault() {
    if (!wrapperEl || !joystickEl) return;
    const rect = wrapperEl.getBoundingClientRect();
    setJoystickOrigin(rect.width * DEFAULT_JOYSTICK_POS.x, rect.height * DEFAULT_JOYSTICK_POS.y);
}

function setJoystickOrigin(localX, localY) {
    origin = { x: localX, y: localY };
    joystickEl.style.left = `${localX}px`;
    joystickEl.style.top = `${localY + (CONFIG.joystickVisualOffset || 0)}px`;
}

function markJoystickActive() {
    if (!joystickEl) return;
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
    joystickEl.classList.remove('is-idle');
}

function scheduleIdleState() {
    if (!joystickEl) return;
    if (idleTimeoutId) clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => {
        if (!joystick.isActive) joystickEl.classList.add('is-idle');
        idleTimeoutId = null;
    }, JOYSTICK_IDLE_DELAY);
}
