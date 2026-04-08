export const DEFAULT_CONFIG = {
    shootCooldown: 0.35,
    deploySpeed: 40,
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
    sceneMode: 'endless',
    turnSpeed: 18,
    moveAcceleration: 25,
    moveFriction: 12,
    bloomStrength: 0.3,
    bloomThreshold: 0.1,
    bloomRadius: 0.5,
    playerScale: 2.5,
    enemyScale: 2.0,
    damageTextScale: 0.6,
    hudScale: 1.0,
    shakeIntensityRecall: 0.1, 
    shakeIntensityDeath: 0.4,  
    shakeIntensityFinal: 0.8,  
    shakeDuration: 0.15,
    bloodLinger: 5.0,
    cameraVerticalDeadZone: 6.0,
    audioEnabled: true,
    audioVolume: 0.42
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
