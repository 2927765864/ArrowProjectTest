export const DEFAULT_CONFIG = {
    shootCooldown: 0.35,
    deployInitialSpeed: 60,
    deployFriction: 80,
    deployMinSpeed: 15,
    pierceDistBeforeDrop: 1.5,
    groundInsertPitch: 80,
    recallInterval: 100,
    baseRecallSpeed: 70,
    finalRecallDelay: 300,
    finalRecallSpeed: 20,
    tetherDashLength: 0.3,
    tetherGapLength: 0.4,
    tetherThickness: 0.03,
    tetherSegmentCount: 8,
    specialTetherDashLength: 0.3,
    specialTetherGapLength: 0.5,
    specialTetherThickness: 0.13,
    specialTetherSegmentCount: 10,
    sceneMode: 'obstacles', // endless, empty, obstacles, dummy
    floorStyle: 'solid', // solid, checkerboard
    maxMoveSpeedX: 7.5,
    maxMoveSpeedZ: 10,
    showPlayerTrajectory: false,
    showCollisionBox: false,
    useCustomCollision: false,
    customCollisionRadius: 0.2,
    cameraMode: 'orthographic',
    cameraFov: 45,
    cameraDist: 60,
    cameraAngleX: 55,
    cameraAngleY: 0,
    cameraViewScale: 1.0,
    cameraFollowEnabled: true,
    moveFacingMode: 'decoupled', // decoupled, faceMoveDirection
    turnSpeed: 18,
    moveAcceleration: 25,
    moveFriction: 12,
    bloomStrength: 0.3,
    bloomThreshold: 0.1,
    bloomRadius: 0.5,
    xrayEnabled: true,
    playerScale: 2.5,
    indicatorMaxRange: 0.6,
    indicatorMaxInput: 1.8,
    enemyScale: 2.0,
    damageTextScale: 0.6,
    hudScale: 1.0,
    shakeIntensityRecall: 0.1, 
    shakeIntensityDeath: 0.4,  
    shakeIntensityFinal: 0.8,  
    shakeDuration: 0.15,
    hapticEnabled: true,
    hapticIntensity: 1.0,
    bloodLinger: 5.0,
    cameraVerticalDeadZone: 6.0,
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
    joystickVisualOffset: 25,
    joystickDeadZone: 3,
    joystickLockRadius: 15,
    joystickFastTraverseMs: 100,
    joystickSmoothFactor: 0.35
};

export const CONFIG = { ...DEFAULT_CONFIG };

// Load from localStorage if available
try {
    const savedConfig = localStorage.getItem('arrowProjectConfig');
    if (savedConfig) {
        Object.assign(CONFIG, JSON.parse(savedConfig));
    }
} catch (e) {
    console.error('Failed to load config from localStorage', e);
}
