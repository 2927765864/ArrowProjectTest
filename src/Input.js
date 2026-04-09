export const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };
export const joystick = { x: 0, y: 0, isActive: false };

const DEFAULT_JOYSTICK_POS = { x: 0.5, y: 0.78 };
const JOYSTICK_IDLE_DELAY = 1000;
let activePointerId = null;
let wrapperEl = null;
let joystickEl = null;
let knobEl = null;
let joystickVisualRadius = 39; // 视觉上摇杆能推到的最远边缘 (Base 半径 68 - Knob 半径 29)
let joystickLogicalRadius = 28; // 实际逻辑上推到满速 (1.0) 所需的滑动距离
let origin = { x: 0, y: 0 };
let idleTimeoutId = null;

export function initInput(wrapper) {
    wrapperEl = wrapper;
    joystickEl = document.getElementById('virtual-joystick');
    knobEl = document.getElementById('joystick-knob');

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
    joystick.isActive = false;
    knobEl.style.transform = 'translate(-50%, -50%)';
    placeJoystickAtDefault();
    joystickEl.classList.remove('is-active');
    scheduleIdleState();
}

function updateJoystick(localX, localY) {
    const dx = localX - origin.x;
    const dy = localY - origin.y;
    const distance = Math.hypot(dx, dy);
    
    // 视觉上 Knob 能够到达的物理边缘
    const visualDistance = Math.min(distance, joystickVisualRadius);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * visualDistance;
    const knobY = Math.sin(angle) * visualDistance;

    // 物理输出：允许比 1.0 更大，用于控制指示器继续延伸。
    // 在 distance = 28 时到达 1.0 (全速移动阈值)
    // 设一个更大的范围（比如手指拉到 80px）才能让指示器达到最大半径（约 1.5 倍）
    const logicIntensity = distance === 0 ? 0 : distance / joystickLogicalRadius;
    const maxIndicatorIntensity = 1.8; // 允许指示器拉伸到 1.8 倍
    const clampedIntensity = Math.min(logicIntensity, maxIndicatorIntensity);
    
    joystick.x = Math.cos(angle) * clampedIntensity;
    joystick.y = Math.sin(angle) * clampedIntensity;
    
    knobEl.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
}

function placeJoystickAtDefault() {
    if (!wrapperEl || !joystickEl) return;
    const rect = wrapperEl.getBoundingClientRect();
    setJoystickOrigin(rect.width * DEFAULT_JOYSTICK_POS.x, rect.height * DEFAULT_JOYSTICK_POS.y);
}

function setJoystickOrigin(localX, localY) {
    origin = { x: localX, y: localY };
    joystickEl.style.left = `${localX}px`;
    joystickEl.style.top = `${localY}px`;
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
