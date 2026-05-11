import * as THREE from 'three';
import { CONFIG, DEFAULT_CONFIG, migrateDamageTextConfig } from '../config.js';
import { Globals } from '../utils.js';
import { clearSceneEntities, refreshBoundaryVisual, refreshCameraFollow, refreshCameraMode, updateCameraPosition, setActiveSceneMode, redrawBrickFloorTexture, refreshBrickBaseLayer } from '../main.js';
import { buildCurvePanel } from './BezierCurveEditor.js';
import { EnemyHitBurstEffect } from '../effects/EnemyHitBurstEffect.js';

const PANEL_VERSION = 'v2026.05.07-1824';

export function setupControlPanel() {
    const controlPanel = document.getElementById('control-panel');
    const versionEl = document.getElementById('panel-version');
    if (versionEl) versionEl.innerText = PANEL_VERSION;

    const stopEvent = (e) => e.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel'].forEach((eventName) => {
        controlPanel?.addEventListener(eventName, stopEvent, { passive: false });
    });

    // ===== 调节面板显隐控制 =====
    // 入口：屏幕左上角的"测试"按钮 (#panel-trigger)，连按三下打开面板。
    // 关闭：面板头部的"隐藏"按钮 (#toggle-panel)。
    const panelTrigger = document.getElementById('panel-trigger');
    const togglePanelBtn = document.getElementById('toggle-panel');
    const showPanel = () => {
        if (controlPanel) controlPanel.style.display = '';
    };
    const hidePanel = () => {
        if (controlPanel) controlPanel.style.display = 'none';
    };
    if (panelTrigger) {
        let tapCount = 0;
        let tapTimer = 0;
        const TRIPLE_TAP_WINDOW_MS = 600; // 三连击的最大间隔窗口
        const handleTap = () => {
            tapCount += 1;
            // 给按钮加一个短暂的视觉反馈（CSS 中 .is-hit 已定义）
            panelTrigger.classList.add('is-hit');
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => {
                tapCount = 0;
                panelTrigger.classList.remove('is-hit');
            }, TRIPLE_TAP_WINDOW_MS);
            if (tapCount >= 3) {
                tapCount = 0;
                clearTimeout(tapTimer);
                panelTrigger.classList.remove('is-hit');
                showPanel();
            }
        };
        // 同时监听 click 与 keydown(Enter/Space)，桌面/移动/键盘都能触发
        panelTrigger.addEventListener('click', handleTap);
        panelTrigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTap();
            }
        });
    }
    if (togglePanelBtn) {
        togglePanelBtn.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            hidePanel();
        });
    }

    const audioEnabledInput = document.getElementById('inp-aen');
    const audioEnabledValue = document.getElementById('val-aen');
    const audioVolumeInput = document.getElementById('inp-avl');
    const audioVolumeValue = document.getElementById('val-avl');
    
    if (CONFIG.audioEnabled !== undefined) {
        if (Globals.audioManager) Globals.audioManager.setEnabled(CONFIG.audioEnabled);
    }
    if (CONFIG.audioVolume !== undefined) {
        if (Globals.audioManager) Globals.audioManager.setVolume(CONFIG.audioVolume);
    }

    const syncAudioUi = () => {
        const audio = Globals.audioManager;
        if (!audio || !audioEnabledInput || !audioVolumeInput) return;
        audioEnabledInput.checked = audio.enabled;
        audioEnabledValue.innerText = audio.enabled ? '开' : '关';
        audioVolumeInput.value = String(audio.volume);
        audioVolumeValue.innerText = audio.volume.toFixed(2);
    };
    syncAudioUi();

    if (audioEnabledInput) {
        audioEnabledInput.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            CONFIG.audioEnabled = enabled;
            Globals.audioManager?.setEnabled(enabled);
            audioEnabledValue.innerText = enabled ? '开' : '关';
        });
    }

    if (audioVolumeInput) {
        audioVolumeInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.audioVolume = val;
            Globals.audioManager?.setVolume(val);
            audioVolumeValue.innerText = val.toFixed(2);
        });
    }

    const btnScm = document.getElementById('btn-scm');
    const valScm = document.getElementById('val-scm');
    
    if (CONFIG.sceneMode === 'empty') {
        valScm.innerText = '空旷';
        btnScm.innerText = '切换为无尽';
    } else if (CONFIG.sceneMode === 'obstacles') {
        valScm.innerText = '障碍测试';
        btnScm.innerText = '切换为木桩';
    } else if (CONFIG.sceneMode === 'dummy') {
        valScm.innerText = '木桩';
        btnScm.innerText = '切换为四人小队';
    } else if (CONFIG.sceneMode === 'wave4') {
        valScm.innerText = '四人小队';
        btnScm.innerText = '切换为空旷';
    } else {
        valScm.innerText = '无尽';
        btnScm.innerText = '切换为障碍测试';
    }
    
    btnScm.addEventListener('click', () => {
        Globals.audioManager?.playUIClick();
        // 循环顺序: endless → obstacles → dummy → wave4 → empty → endless
        const nextMap = {
            endless:   'obstacles',
            obstacles: 'dummy',
            dummy:     'wave4',
            wave4:     'empty',
            empty:     'endless',
        };
        const next = nextMap[CONFIG.sceneMode] ?? 'endless';
        // setActiveSceneMode 会同步标签文字和右上角按钮
        setActiveSceneMode(next);
    });

    const btnFlm = document.getElementById('btn-flm');
    const valFlm = document.getElementById('val-flm');
    const btnCfl = document.getElementById('btn-cfl');
    const valCfl = document.getElementById('val-cfl');
    
    // 三态循环顺序：solid -> checkerboard -> brick -> solid
    const FLOOR_STYLE_ORDER = ['solid', 'checkerboard', 'brick'];
    const FLOOR_STYLE_LABEL = { solid: '纯色', checkerboard: '黑白格子', brick: '砖块' };
    const updateFloorStyleUi = () => {
        const cur = CONFIG.floorStyle;
        const idx = FLOOR_STYLE_ORDER.indexOf(cur);
        const next = FLOOR_STYLE_ORDER[(idx + 1) % FLOOR_STYLE_ORDER.length];
        valFlm.innerText = FLOOR_STYLE_LABEL[cur] || '纯色';
        btnFlm.innerText = '切换为' + (FLOOR_STYLE_LABEL[next] || '纯色');
    };
    updateFloorStyleUi();

    btnFlm.addEventListener('click', () => {
        Globals.audioManager?.playUIClick();
        const idx = FLOOR_STYLE_ORDER.indexOf(CONFIG.floorStyle);
        CONFIG.floorStyle = FLOOR_STYLE_ORDER[(idx + 1) % FLOOR_STYLE_ORDER.length];
        updateFloorStyleUi();
        refreshBoundaryVisual();
    });

    const syncCameraFollowUi = () => {
        if (CONFIG.cameraFollowEnabled === false) {
            valCfl.innerText = '关';
            btnCfl.innerText = '开启相机跟随';
        } else {
            valCfl.innerText = '开';
            btnCfl.innerText = '关闭相机跟随';
        }
    };
    syncCameraFollowUi();

    btnCfl.addEventListener('click', () => {
        Globals.audioManager?.playUIClick();
        CONFIG.cameraFollowEnabled = CONFIG.cameraFollowEnabled === false;
        syncCameraFollowUi();
        refreshCameraFollow();
    });

    // 数字输入框绑定：直接在 input 自身显示和编辑数值，无需独立的 valDisplay。
    // 适合大范围（如 0~1000）/ 需要精确数值（伤害、HP 等）的整数参数。
    // clampOnBlur=true 时在 blur/change 时把超界值夹到 min/max 之间。
    const bindNumber = (inputId, configKey, isFloat = false, clampOnBlur = true) => {
        const input = document.getElementById(inputId);
        if (!input) return;

        const fmt = (v) => isFloat ? Number(v).toFixed(2) : String(Math.round(Number(v)));

        if (CONFIG[configKey] !== undefined) {
            input.value = fmt(CONFIG[configKey]);
        }

        input.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        // input 事件：用户敲键 / 点 spinner 时实时同步到 CONFIG（仅当能解析为合法数字时）。
        input.addEventListener('input', (e) => {
            const raw = e.target.value;
            if (raw === '' || raw === '-') return; // 允许中间态（清空 / 只输入负号）
            const val = parseFloat(raw);
            if (Number.isNaN(val)) return;
            CONFIG[configKey] = isFloat ? val : Math.round(val);
        });
        // change/blur：失焦时把内容标准化（夹到 min/max + 重新格式化）。
        const finalize = () => {
            let val = parseFloat(input.value);
            if (Number.isNaN(val)) val = CONFIG[configKey] ?? 0;
            if (clampOnBlur) {
                const min = parseFloat(input.min);
                const max = parseFloat(input.max);
                if (!Number.isNaN(min) && val < min) val = min;
                if (!Number.isNaN(max) && val > max) val = max;
            }
            if (!isFloat) val = Math.round(val);
            CONFIG[configKey] = val;
            input.value = fmt(val);
        };
        input.addEventListener('change', finalize);
        input.addEventListener('blur', finalize);
    };

    const bindSlider = (inputId, valId, configKey, isFloat = false) => {
        const input = document.getElementById(inputId);
        const valDisplay = document.getElementById(valId);
        
        if (!input || !valDisplay) return; // Fail gracefully if DOM element is missing

        // Initialize from CONFIG
        if (CONFIG[configKey] !== undefined) {
            input.value = CONFIG[configKey];
            valDisplay.innerText = isFloat ? CONFIG[configKey].toFixed(2) : (configKey === 'bloodLinger' ? CONFIG[configKey].toFixed(1) : CONFIG[configKey]);
        }
        
        input.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        input.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG[configKey] = val;
            valDisplay.innerText = isFloat ? val.toFixed(2) : (configKey === 'bloodLinger' ? val.toFixed(1) : val);
        });
    };

    // 主动穿刺（飞行途中命中）
    bindSlider('inp-stn',  'val-stn',  'shakeIntensityThrow',        true);
    bindSlider('inp-stnd', 'val-stnd', 'shakeDurationThrow',         true);
    bindSlider('inp-sts',  'val-sts',  'shakeIntensityThrowSpecial', true);
    bindSlider('inp-stsd', 'val-stsd', 'shakeDurationThrowSpecial',  true);
    // 回收穿刺
    bindSlider('inp-sr',   'val-sr',   'shakeIntensityRecall',       true);
    bindSlider('inp-srd',  'val-srd',  'shakeDurationRecall',        true);
    bindSlider('inp-sf',   'val-sf',   'shakeIntensityFinal',        true);
    bindSlider('inp-sfd',  'val-sfd',  'shakeDurationFinal',         true);
    // 死亡（通用兜底）
    bindSlider('inp-si',   'val-si',   'shakeIntensityDeath',        true);
    bindSlider('inp-sd',   'val-sd',   'shakeDuration',              true);
    bindSlider('inp-bl', 'val-bl', 'bloodLinger', true);

    bindSlider('inp-cd', 'val-cd', 'shootCooldown', true);
    // 玩家伤害（整数，0~1000，数字输入框）
    bindNumber('inp-padmg',  'playerAttackDamage');
    bindNumber('inp-prdmg',  'playerRecallDamage');
    bindNumber('inp-prdmgs', 'playerRecallDamageSpecial');
    bindSlider('inp-awd', 'val-awd', 'attackWindupDur', true);
    bindSlider('inp-awds', 'val-awds', 'attackWindupDurSpecial', true);
    bindSlider('inp-awhr', 'val-awhr', 'attackWindupHoldRatio', true);
    bindSlider('inp-awhrs', 'val-awhrs', 'attackWindupHoldRatioSpecial', true);
    bindSlider('inp-ard', 'val-ard', 'attackRecoverDur', true);
    bindSlider('inp-ards', 'val-ards', 'attackRecoverDurSpecial', true);
    bindSlider('inp-aitd', 'val-aitd', 'attackThrowSpawnDelay', true);
    bindSlider('inp-ahws', 'val-ahws', 'attackHeldWeaponScale', true);
    bindSlider('inp-ahvp', 'val-ahvp', 'attackHitVisualPause', true);
    bindSlider('inp-ahvps', 'val-ahvps', 'attackHitVisualPauseSpecial', true);
    // Attack posture amplitudes
    bindSlider('inp-alb', 'val-alb', 'attackLeanBackX', true);
    bindSlider('inp-albs', 'val-albs', 'attackLeanBackXSpecial', true);
    bindSlider('inp-atb', 'val-atb', 'attackTwistBackY', true);
    bindSlider('inp-atbs', 'val-atbs', 'attackTwistBackYSpecial', true);
    bindSlider('inp-als', 'val-als', 'attackLeanSideZ', true);
    bindSlider('inp-alss', 'val-alss', 'attackLeanSideZSpecial', true);
    bindSlider('inp-atf', 'val-atf', 'attackThrowForwardX', true);
    bindSlider('inp-atfs', 'val-atfs', 'attackThrowForwardXSpecial', true);
    bindSlider('inp-att', 'val-att', 'attackThrowTwistY', true);
    bindSlider('inp-atts', 'val-atts', 'attackThrowTwistYSpecial', true);
    bindSlider('inp-ats', 'val-ats', 'attackThrowSideZ', true);
    bindSlider('inp-atss', 'val-atss', 'attackThrowSideZSpecial', true);
    bindSlider('inp-abr', 'val-abr', 'attackBurstRatio', true);
    bindSlider('inp-abrs', 'val-abrs', 'attackBurstRatioSpecial', true);

    // Lower-body: lunge stance + attack overlay (8 params, fully rebuilt).
    // Stance base (idle posture — the "coiled" bow stance)
    bindSlider('inp-asft', 'val-asft', 'attackStanceFrontThigh', true);
    bindSlider('inp-asfk', 'val-asfk', 'attackStanceFrontKnee', true);
    bindSlider('inp-asrt', 'val-asrt', 'attackStanceRearThigh', true);
    bindSlider('inp-asrk', 'val-asrk', 'attackStanceRearKnee', true);
    // Attack overlay deltas (applied on top of stance base; kept small so
    // feet don't slide noticeably relative to the hip during the throw)
    bindSlider('inp-alwt', 'val-alwt', 'attackLegWindupThigh', true);
    bindSlider('inp-alwk', 'val-alwk', 'attackLegWindupKnee', true);
    bindSlider('inp-altt', 'val-altt', 'attackLegThrowThigh', true);
    bindSlider('inp-altk', 'val-altk', 'attackLegThrowKnee', true);
    // Hip follow: how much the leg anchor rotates with the upper body's
    // attack twist/lean (0 = no coupling, 1 = full coupling / feet swept)
    bindSlider('inp-ahfy', 'val-ahfy', 'attackHipFollowY', true);
    bindSlider('inp-ahfz', 'val-ahfz', 'attackHipFollowZ', true);
    bindSlider('inp-abdw',  'val-abdw',  'attackBodyDipWindup', true);
    bindSlider('inp-abdws', 'val-abdws', 'attackBodyDipWindupSpecial', true);
    bindSlider('inp-ablt',  'val-ablt',  'attackBodyLiftThrow', true);
    bindSlider('inp-ablts', 'val-ablts', 'attackBodyLiftThrowSpecial', true);
    // Hip rotation pivot: left-foot anchor (hip rotates around planted left foot)
    bindSlider('inp-alfpx',  'val-alfpx',  'attackLeftFootPivotX', true);
    bindSlider('inp-alfpz',  'val-alfpz',  'attackLeftFootPivotZ', true);
    // Hip (hipPivotGroup) rotation — drives pelvis, propagates to legs & tail
    bindSlider('inp-ahtby',  'val-ahtby',  'attackHipTwistBackY', true);
    bindSlider('inp-ahtbys', 'val-ahtbys', 'attackHipTwistBackYSpecial', true);
    bindSlider('inp-ahlsz',  'val-ahlsz',  'attackHipLeanSideZ', true);
    bindSlider('inp-ahlszs', 'val-ahlszs', 'attackHipLeanSideZSpecial', true);
    bindSlider('inp-ahtty',  'val-ahtty',  'attackHipThrowTwistY', true);
    bindSlider('inp-ahttys', 'val-ahttys', 'attackHipThrowTwistYSpecial', true);
    bindSlider('inp-ahtsz',  'val-ahtsz',  'attackHipThrowSideZ', true);
    bindSlider('inp-ahtszs', 'val-ahtszs', 'attackHipThrowSideZSpecial', true);

    // Idle body breathing (stationary state — between attacks / pure idle)
    bindSlider('inp-ibsy',  'val-ibsy',  'idleBodyShakeY', true);
    bindSlider('inp-ibss',  'val-ibss',  'idleBodyShakeSpeed', true);

    // 投掷手臂蓄力姿态（大臂 XYZ 旋转 + 小臂弯曲）
    bindSlider('inp-aapx',  'val-aapx',  'attackArmPullX',        true);
    bindSlider('inp-aapxs', 'val-aapxs', 'attackArmPullXSpecial', true);
    bindSlider('inp-aapy',  'val-aapy',  'attackArmPullY',        true);
    bindSlider('inp-aapys', 'val-aapys', 'attackArmPullYSpecial', true);
    bindSlider('inp-aapz',  'val-aapz',  'attackArmPullZ',        true);
    bindSlider('inp-aapzs', 'val-aapzs', 'attackArmPullZSpecial', true);
    bindSlider('inp-aebp',  'val-aebp',  'attackElbowBendPull',        true);
    bindSlider('inp-aebps', 'val-aebps', 'attackElbowBendPullSpecial', true);

    // 辅助手姿态（蓄力：大臂前伸 + 小臂横胸前；投出：甩到身后）
    bindSlider('inp-aswx',  'val-aswx',  'attackSupportArmWindupX',        true);
    bindSlider('inp-aswxs', 'val-aswxs', 'attackSupportArmWindupXSpecial', true);
    bindSlider('inp-aswy',  'val-aswy',  'attackSupportArmWindupY',        true);
    bindSlider('inp-aswys', 'val-aswys', 'attackSupportArmWindupYSpecial', true);
    bindSlider('inp-aswz',  'val-aswz',  'attackSupportArmWindupZ',        true);
    bindSlider('inp-aswzs', 'val-aswzs', 'attackSupportArmWindupZSpecial', true);
    bindSlider('inp-asew',  'val-asew',  'attackSupportElbowWindup',        true);
    bindSlider('inp-asews', 'val-asews', 'attackSupportElbowWindupSpecial', true);
    bindSlider('inp-astx',  'val-astx',  'attackSupportArmThrowX',        true);
    bindSlider('inp-astxs', 'val-astxs', 'attackSupportArmThrowXSpecial', true);
    bindSlider('inp-asty',  'val-asty',  'attackSupportArmThrowY',        true);
    bindSlider('inp-astys', 'val-astys', 'attackSupportArmThrowYSpecial', true);
    bindSlider('inp-astz',  'val-astz',  'attackSupportArmThrowZ',        true);
    bindSlider('inp-astzs', 'val-astzs', 'attackSupportArmThrowZSpecial', true);
    bindSlider('inp-aset', 'val-aset', 'attackSupportElbowThrow', true);
    bindSlider('inp-asets', 'val-asets', 'attackSupportElbowThrowSpecial', true);

    bindSlider('inp-awhx', 'val-awhx', 'attackWeaponHoldPosX', true);
    bindSlider('inp-awhy', 'val-awhy', 'attackWeaponHoldPosY', true);
    bindSlider('inp-awhz', 'val-awhz', 'attackWeaponHoldPosZ', true);
    bindSlider('inp-awhrx', 'val-awhrx', 'attackWeaponHoldRotX', true);
    bindSlider('inp-awhry', 'val-awhry', 'attackWeaponHoldRotY', true);
    bindSlider('inp-awhrz', 'val-awhrz', 'attackWeaponHoldRotZ', true);
    bindSlider('inp-awhsr', 'val-awhsr', 'attackWeaponHoldStayRatio', true);
    bindSlider('inp-awhoz', 'val-awhoz', 'attackWeaponHoldOffsetZ', true);
    bindSlider('inp-awhpd', 'val-awhpd', 'attackWeaponHoldPopDuration', true);
    bindSlider('inp-awhpo', 'val-awhpo', 'attackWeaponHoldPopOvershoot', true);

    bindSlider('inp-dis', 'val-dis', 'deployInitialSpeed');
    bindSlider('inp-dfr', 'val-dfr', 'deployFriction');
    bindSlider('inp-dms', 'val-dms', 'deployMinSpeed');
    bindSlider('inp-mfof', 'val-mfof', 'maxFeathersOnField');
    bindSlider('inp-pdbd', 'val-pdbd', 'pierceDistBeforeDrop', true);
    // 动态落点距离 · 基于玩家与敌人的距离（开关在下方 bindToggle 区域绑定）
    bindSlider('inp-pdmin', 'val-pdmin', 'pierceDistMin', true);
    bindSlider('inp-pdmax', 'val-pdmax', 'pierceDistMax', true);
    bindSlider('inp-ptnd',  'val-ptnd',  'pierceTriggerNearDist', true);
    bindSlider('inp-ptfd',  'val-ptfd',  'pierceTriggerFarDist',  true);
    bindSlider('inp-appss', 'val-appss', 'attackPostPierceSpeedScale', true);
    bindSlider('inp-gip', 'val-gip', 'groundInsertPitch');
    bindSlider('inp-appptb', 'val-appptb', 'attackPitchPivotTipBias', true);
    bindSlider('inp-appto', 'val-appto', 'attackPitchPivotTipOffset', true);
    bindSlider('inp-ri', 'val-ri', 'recallInterval');
    bindSlider('inp-rmds', 'val-rmds', 'recallMoveDistanceAfterStop', true);
    bindSlider('inp-rs', 'val-rs', 'baseRecallSpeed');
    bindSlider('inp-frd', 'val-frd', 'finalRecallDelay');
    bindSlider('inp-frs', 'val-frs', 'finalRecallSpeed');

    bindSlider('inp-rced', 'val-rced', 'recallCourierEmergeDur', true);
    bindSlider('inp-rcwd', 'val-rcwd', 'recallCourierWindupDur', true);
    bindSlider('inp-rctd', 'val-rctd', 'recallCourierThrowDur', true);
    bindSlider('inp-rchd', 'val-rchd', 'recallCourierHoldDur', true);
    bindSlider('inp-rcfd', 'val-rcfd', 'recallCourierFadeDur', true);

    bindSlider('inp-rcsc', 'val-rcsc', 'recallCourierScale', true);
    bindSlider('inp-rcscs', 'val-rcscs', 'recallCourierScaleSpecial', true);

    bindSlider('inp-rcws', 'val-rcws', 'recallCourierWeaponScale', true);
    bindSlider('inp-rcwss', 'val-rcwss', 'recallCourierWeaponScaleSpecial', true);

    bindSlider('inp-rcwox', 'val-rcwox', 'recallCourierWeaponOffsetX', true);
    bindSlider('inp-rcwoy', 'val-rcwoy', 'recallCourierWeaponOffsetY', true);
    bindSlider('inp-rcwoz', 'val-rcwoz', 'recallCourierWeaponOffsetZ', true);

    bindSlider('inp-rcwbrx', 'val-rcwbrx', 'recallCourierWeaponBaseRotX');
    bindSlider('inp-rcwbry', 'val-rcwbry', 'recallCourierWeaponBaseRotY');
    bindSlider('inp-rcwbrz', 'val-rcwbrz', 'recallCourierWeaponBaseRotZ');

    bindSlider('inp-rcwwrx', 'val-rcwwrx', 'recallCourierWeaponWindupRotX');
    bindSlider('inp-rcwtrx', 'val-rcwtrx', 'recallCourierWeaponThrowRotX');
    bindSlider('inp-drrn', 'val-drrn', 'deployRingRadiusNormal', true);
    bindSlider('inp-drrs', 'val-drrs', 'deployRingRadiusSpecial', true);
    bindSlider('inp-dron', 'val-dron', 'deployRingOpacityNormal', true);
    bindSlider('inp-dros', 'val-dros', 'deployRingOpacitySpecial', true);
    bindSlider('inp-das', 'val-das', 'deployArrowScale', true);
    bindSlider('inp-dal', 'val-dal', 'deployArrowLength', true);
    bindSlider('inp-dao', 'val-dao', 'deployArrowOpacity', true);

    // 📳 屏幕与马达震动
    const bindCheckbox = (inputId, labelId, configKey) => {
        const inp = document.getElementById(inputId);
        const lbl = document.getElementById(labelId);
        if(!inp || !lbl) return;
        inp.checked = !!CONFIG[configKey];
        lbl.innerText = CONFIG[configKey] ? '开' : '关';
        inp.addEventListener('change', (e) => {
            CONFIG[configKey] = e.target.checked;
            lbl.innerText = e.target.checked ? '开' : '关';
        });
    };

    bindCheckbox('inp-hen', 'val-hen', 'hapticEnabled');
    bindSlider('inp-hint', 'val-hint', 'hapticIntensity', true);

    const btnTestHaptic = document.getElementById('btn-test-haptic');
    if (btnTestHaptic) {
        btnTestHaptic.addEventListener('click', () => {
            if (!CONFIG.hapticEnabled) return;
            const duration = 50;
            const amplitude = Math.floor(150 * CONFIG.hapticIntensity);
            if (window.AndroidNative && window.AndroidNative.vibrate) {
                window.AndroidNative.vibrate(duration, amplitude);
            } else if (navigator.vibrate) {
                navigator.vibrate(duration);
            }
        });
    }

    bindSlider('inp-tns', 'val-tns', 'turnSpeed');
    bindSlider('inp-abts', 'val-abts', 'attackBreakTurnSpeed');
    bindSlider('inp-m2ats', 'val-m2ats', 'moveToAttackTurnSpeed');
    bindSlider('inp-mva', 'val-mva', 'moveAcceleration');
    bindSlider('inp-mvf', 'val-mvf', 'moveFriction');
    bindSlider('inp-wsbm', 'val-wsbm', 'wallSlideBaseMultiplier', true);
    bindSlider('inp-wsam', 'val-wsam', 'wallSlideAngleMultiplier', true);
    bindSlider('inp-mmsx', 'val-mmsx', 'maxMoveSpeedX');
    bindSlider('inp-mmsz', 'val-mmsz', 'maxMoveSpeedZ');
    bindSlider('inp-ccr', 'val-ccr', 'customCollisionRadius');
    bindSlider('inp-pbnc', 'val-pbnc', 'playerBounce', true);
    bindSlider('inp-ras', 'val-ras', 'runArmSpread', true);
    bindSlider('inp-rsw', 'val-rsw', 'runArmSwing', true);
    bindSlider('inp-rbu', 'val-rbu', 'runBodyUpShake', true);
    bindSlider('inp-rbs', 'val-rbs', 'runBodySway', true);
    bindSlider('inp-rbt', 'val-rbt', 'runBodyTwist', true);
    bindSlider('inp-rbb', 'val-rbb', 'runBurst', true);
    bindSlider('inp-rsf', 'val-rsf', 'runStepFreq', true);
    bindSlider('inp-rlsf', 'val-rlsf', 'runLegSwingForward', true);
    bindSlider('inp-rlsb', 'val-rlsb', 'runLegSwingBackward', true);
    bindSlider('inp-tlrad', 'val-tlrad', 'tailRadius', true);
    bindSlider('inp-tlseg', 'val-tlseg', 'tailSegLength', true);
    bindSlider('inp-mta', 'val-mta', 'modelTiltAngle');
    bindSlider('inp-mho', 'val-mho', 'modelHeightOffset', true);

    const bindToggle = (inputId, valId, configKey) => {
        const input = document.getElementById(inputId);
        const val = document.getElementById(valId);
        
        if (!input || !val) return; // Fail gracefully if DOM element is missing

        if (CONFIG[configKey] !== undefined) {
            input.checked = !!CONFIG[configKey];
            val.innerText = CONFIG[configKey] ? '开' : '关';
        }
        input.addEventListener('change', (e) => {
            CONFIG[configKey] = e.target.checked;
            val.innerText = e.target.checked ? '开' : '关';
        });
    };

    // 动态落点距离开关（与"攻击与回收"分类下的滑块组配套）
    bindToggle('inp-pdde', 'val-pdde', 'pierceDistDynamicEnabled');
    bindToggle('inp-scb', 'val-scb', 'showCollisionBox');
    bindToggle('inp-spt', 'val-spt', 'showPlayerTrajectory');
    bindToggle('inp-pad', 'val-pad', 'playerAttackDisabled');
    bindToggle('inp-dsac', 'val-dsac', 'disableSpecialAttackCycle');

    bindToggle('inp-ucc', 'val-ucc', 'useCustomCollision');
    bindToggle('inp-xre', 'val-xre', 'xrayEnabled');
    bindToggle('inp-poe', 'val-poe', 'playerOutlineEnabled');
    bindToggle('inp-hvd', 'val-hvd', 'hideVisualDistractors');
    bindToggle('inp-sct', 'val-sct', 'showCombatTexts');

    // 帧率显示开关：在切换时同步右上角 #fps-display 的可见性。
    // 实际帧率值由 main.js 的 animate() 循环写入元素文本（仅当开启时）。
    {
        const inp = document.getElementById('inp-fps');
        const lbl = document.getElementById('val-fps');
        const fpsEl = document.getElementById('fps-display');
        const syncFpsVisibility = () => {
            if (fpsEl) fpsEl.classList.toggle('is-visible', !!CONFIG.showFps);
        };
        if (inp && lbl) {
            inp.checked = !!CONFIG.showFps;
            lbl.innerText = CONFIG.showFps ? '开' : '关';
            inp.addEventListener('change', (e) => {
                CONFIG.showFps = e.target.checked;
                lbl.innerText = e.target.checked ? '开' : '关';
                syncFpsVisibility();
            });
        }
        // 即便用户没动开关，初始化时也按 CONFIG（含已加载的存档）同步一次显隐。
        syncFpsVisibility();
    }
    bindToggle('inp-spbr', 'val-spbr', 'showPlayerBaseRing');
    bindToggle('inp-awhpe', 'val-awhpe', 'attackWeaponHoldPopEnabled');

    // Base-ring geometry & fade sliders (3-decimal display for fine control)
    const bindBaseRingSlider = (inputId, valId, configKey, decimals = 3) => {
        const input = document.getElementById(inputId);
        const valDisplay = document.getElementById(valId);
        if (!input || !valDisplay) return;
        if (CONFIG[configKey] !== undefined) {
            input.value = CONFIG[configKey];
            valDisplay.innerText = Number(CONFIG[configKey]).toFixed(decimals);
        }
        input.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        input.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG[configKey] = val;
            valDisplay.innerText = val.toFixed(decimals);
        });
    };
    bindBaseRingSlider('inp-brbg', 'val-brbg', 'baseRingBgRadius',           2);
    bindBaseRingSlider('inp-brao', 'val-brao', 'baseRingArcOuterR',          2);
    bindBaseRingSlider('inp-brat', 'val-brat', 'baseRingArcThickness',       3);
    bindBaseRingSlider('inp-brio', 'val-brio', 'baseRingInnerRingOuterR',    2);
    bindBaseRingSlider('inp-brit', 'val-brit', 'baseRingInnerRingThickness', 3);
    bindBaseRingSlider('inp-brfd', 'val-brfd', 'baseRingFadeDuration',       2);

    const syncCameraModeUi = () => {
        const val = document.getElementById('val-cam-mode');
        const btn = document.getElementById('btn-cam-mode');
        const rowFov = document.getElementById('row-cam-fov');
        const rowScale = document.getElementById('row-cam-scale');
        if (CONFIG.cameraMode === 'perspective') {
            if (val) val.innerText = '透视';
            if (btn) btn.innerText = '切换为正交';
            if (rowFov) rowFov.style.display = 'flex';
            if (rowScale) rowScale.style.display = 'none';
        } else {
            if (val) val.innerText = '正交';
            if (btn) btn.innerText = '切换为透视';
            if (rowFov) rowFov.style.display = 'none';
            if (rowScale) rowScale.style.display = 'flex';
        }
    };
    syncCameraModeUi();

    const btnCamMode = document.getElementById('btn-cam-mode');
    if (btnCamMode) {
        btnCamMode.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            CONFIG.cameraMode = CONFIG.cameraMode === 'orthographic' ? 'perspective' : 'orthographic';
            syncCameraModeUi();
            refreshCameraMode();
        });
    }

    bindSlider('inp-cam-fov', 'val-cam-fov', 'cameraFov');
    bindSlider('inp-cam-dist', 'val-cam-dist', 'cameraDist');
    bindSlider('inp-cam-angx', 'val-cam-angx', 'cameraAngleX');
    bindSlider('inp-cam-angy', 'val-cam-angy', 'cameraAngleY');

    const bindCameraRefresh = (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                updateCameraPosition();
            });
        }
    };
    bindCameraRefresh('inp-cam-dist');
    bindCameraRefresh('inp-cam-angx');
    bindCameraRefresh('inp-cam-angy');
    bindCameraRefresh('inp-cam-fov');

    const inpCvs = document.getElementById('inp-cvs');
    if (inpCvs) {
        if (CONFIG.cameraViewScale !== undefined) {
            inpCvs.value = CONFIG.cameraViewScale;
            document.getElementById('val-cvs').innerText = CONFIG.cameraViewScale.toFixed(1);
        }
        inpCvs.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.cameraViewScale = val;
            document.getElementById('val-cvs').innerText = val.toFixed(1);
            refreshBoundaryVisual();
        });
    }

    // ---- 镜头跟随缓动开关 ----
    const valCfsm = document.getElementById('val-cfsm');
    const btnCfsm = document.getElementById('btn-cfsm');
    const rowCfst = document.getElementById('row-cfst');
    const rowCfms = document.getElementById('row-cfms');
    const syncCameraFollowSmoothingUi = () => {
        const on = CONFIG.cameraFollowSmoothing !== false;
        if (valCfsm) valCfsm.innerText = on ? '开' : '关';
        if (btnCfsm) btnCfsm.innerText = on ? '关闭跟随缓动' : '开启跟随缓动';
        // 缓动关闭时把两个调参滑块灰掉，避免误以为还在生效。
        const dim = on ? '1' : '0.4';
        if (rowCfst) rowCfst.style.opacity = dim;
        if (rowCfms) rowCfms.style.opacity = dim;
    };
    syncCameraFollowSmoothingUi();
    if (btnCfsm) {
        btnCfsm.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            CONFIG.cameraFollowSmoothing = CONFIG.cameraFollowSmoothing === false;
            syncCameraFollowSmoothingUi();
            // 切换瞬间把镜头吸附到玩家当前位置，避免下一帧从陈旧状态弹一下。
            refreshCameraFollow();
        });
    }

    // 缓动时间常数（越小越快跟上）
    const inpCfst = document.getElementById('inp-cfst');
    const valCfstEl = document.getElementById('val-cfst');
    if (inpCfst && valCfstEl) {
        if (CONFIG.cameraFollowSmoothTime !== undefined) {
            inpCfst.value = CONFIG.cameraFollowSmoothTime;
            valCfstEl.innerText = CONFIG.cameraFollowSmoothTime.toFixed(2);
        }
        inpCfst.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        inpCfst.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            CONFIG.cameraFollowSmoothTime = v;
            valCfstEl.innerText = v.toFixed(2);
        });
    }

    // 跟随最大速度（世界单位 / 秒）
    const inpCfms = document.getElementById('inp-cfms');
    const valCfmsEl = document.getElementById('val-cfms');
    if (inpCfms && valCfmsEl) {
        if (CONFIG.cameraFollowMaxSpeed !== undefined) {
            inpCfms.value = CONFIG.cameraFollowMaxSpeed;
            valCfmsEl.innerText = CONFIG.cameraFollowMaxSpeed;
        }
        inpCfms.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        inpCfms.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            CONFIG.cameraFollowMaxSpeed = v;
            valCfmsEl.innerText = v;
        });
    }

    // ---- 镜头跟随上下死区 ----
    // 老预设可能只带 cameraVerticalDeadZone（旧字段）；这里把它当作两个
    // 新字段未定义时的兜底初值，让 UI 显示与玩家上次保存的体验一致。
    const legacyDead = (typeof CONFIG.cameraVerticalDeadZone === 'number')
        ? CONFIG.cameraVerticalDeadZone : 6;
    if (typeof CONFIG.cameraDeadZoneTop !== 'number')    CONFIG.cameraDeadZoneTop = legacyDead;
    if (typeof CONFIG.cameraDeadZoneBottom !== 'number') CONFIG.cameraDeadZoneBottom = legacyDead;

    const bindDeadZone = (inputId, valId, configKey) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(valId);
        if (!input || !valEl) return;
        input.value = CONFIG[configKey];
        valEl.innerText = CONFIG[configKey].toFixed(1);
        input.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        input.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            CONFIG[configKey] = v;
            valEl.innerText = v.toFixed(1);
            // 让旧字段同步成"上下平均"，保证还有代码在读旧字段时不会落后。
            CONFIG.cameraVerticalDeadZone =
                (CONFIG.cameraDeadZoneTop + CONFIG.cameraDeadZoneBottom) * 0.5;
            // 立刻把镜头按新死区重新夹紧到玩家位置。
            refreshCameraFollow();
        });
    };
    bindDeadZone('inp-cdzt', 'val-cdzt', 'cameraDeadZoneTop');
    bindDeadZone('inp-cdzb', 'val-cdzb', 'cameraDeadZoneBottom');

    const inpBst = document.getElementById('inp-bst');
    if (inpBst) {
        if (CONFIG.bloomStrength !== undefined) {
            inpBst.value = CONFIG.bloomStrength;
            document.getElementById('val-bst').innerText = CONFIG.bloomStrength.toFixed(2);
        }
        inpBst.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.bloomStrength = val;
            document.getElementById('val-bst').innerText = val.toFixed(2);
            if (Globals.bloomPass) Globals.bloomPass.strength = val;
        });
    }

    const inpBth = document.getElementById('inp-bth');
    if (inpBth) {
        if (CONFIG.bloomThreshold !== undefined) {
            inpBth.value = CONFIG.bloomThreshold;
            document.getElementById('val-bth').innerText = CONFIG.bloomThreshold.toFixed(2);
        }
        inpBth.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.bloomThreshold = val;
            document.getElementById('val-bth').innerText = val.toFixed(2);
            if (Globals.bloomPass) Globals.bloomPass.threshold = val;
        });
    }

    bindSlider('inp-pot', 'val-pot', 'playerOutlineThickness', true);

    const inpPs = document.getElementById('inp-ps');
    if (inpPs) {
        if (CONFIG.playerScale !== undefined) {
            inpPs.value = CONFIG.playerScale;
            document.getElementById('val-ps').innerText = CONFIG.playerScale.toFixed(1);
        }
        inpPs.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.playerScale = val;
            document.getElementById('val-ps').innerText = val.toFixed(1);
            if (Globals.player) Globals.player.mesh.scale.setScalar(val);
            refreshBoundaryVisual();
        });
    }

    // 脚底圆形阴影半径
    const inpPsr = document.getElementById('inp-psr');
    const valPsr = document.getElementById('val-psr');
    if (inpPsr) {
        if (CONFIG.playerShadowRadius !== undefined) {
            inpPsr.value = CONFIG.playerShadowRadius;
            if (valPsr) valPsr.innerText = CONFIG.playerShadowRadius.toFixed(2);
        }
        inpPsr.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.playerShadowRadius = val;
            if (valPsr) valPsr.innerText = val.toFixed(2);
            // 运行时重建 CircleGeometry 以应用新的基础半径（_updateAnimation_shared 仍会按弹跳高度施加 scale）
            const player = Globals.player;
            if (player && player.shadowMesh) {
                const segments = player._shadowSegments || 32;
                const oldGeo = player.shadowMesh.geometry;
                player.shadowMesh.geometry = new THREE.CircleGeometry(val, segments);
                if (oldGeo && typeof oldGeo.dispose === 'function') oldGeo.dispose();
            }
        });
    }

    const inpImr = document.getElementById('inp-imr');
    if (CONFIG.indicatorMaxRange !== undefined && inpImr) {
        inpImr.value = CONFIG.indicatorMaxRange;
        document.getElementById('val-imr').innerText = CONFIG.indicatorMaxRange.toFixed(1);
    }
    if (inpImr) {
        inpImr.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.indicatorMaxRange = val;
            document.getElementById('val-imr').innerText = val.toFixed(1);
        });
    }

    const inpImi = document.getElementById('inp-imi');
    if (CONFIG.indicatorMaxInput !== undefined && inpImi) {
        inpImi.value = CONFIG.indicatorMaxInput;
        document.getElementById('val-imi').innerText = CONFIG.indicatorMaxInput.toFixed(1);
    }
    if (inpImi) {
        inpImi.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.indicatorMaxInput = val;
            document.getElementById('val-imi').innerText = val.toFixed(1);
        });
    }
    
    const inpEs = document.getElementById('inp-es');
    if (inpEs) {
        if (CONFIG.enemyScale !== undefined) {
            inpEs.value = CONFIG.enemyScale;
            document.getElementById('val-es').innerText = CONFIG.enemyScale.toFixed(1);
        }
        inpEs.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.enemyScale = val;
            document.getElementById('val-es').innerText = val.toFixed(1);
            Globals.enemies.forEach(enemy => enemy.mesh.scale.setScalar(val));
        });
    }

    // 👾 敌人分组 · 血量（数字输入框，0~10000） + 移动速度（base + 随机幅度）
    bindNumber('inp-ehp', 'enemyHP');
    bindSlider('inp-emsb', 'val-emsb', 'enemyMoveSpeedBase',   true);
    bindSlider('inp-emsr', 'val-emsr', 'enemyMoveSpeedRandom', true);

    // 💥 敌人受击反馈 · 闪白 + Squash & Stretch 形变 + 击退/眩晕（统一影响球形/柱状/木桩三类敌人）
    bindSlider('inp-hfd',  'val-hfd',  'hitFlashDuration',          true);
    bindSlider('inp-hfi',  'val-hfi',  'hitFlashIntensity',         true);
    // 弹簧节奏
    bindSlider('inp-hds',  'val-hds',  'hitDeformStiffness',        false);
    bindSlider('inp-hdm',  'val-hdm',  'hitDeformDamping',          true);
    bindSlider('inp-hdu',  'val-hdu',  'hitDeformDuration',         true);
    // Squash 阶段
    bindSlider('inp-hdsa', 'val-hdsa', 'hitDeformSquashAxis',       true);
    bindSlider('inp-hdsb', 'val-hdsb', 'hitDeformSquashBulge',      true);
    // Stretch 阶段
    bindSlider('inp-hdta', 'val-hdta', 'hitDeformStretchAxis',      true);
    bindSlider('inp-hdtp', 'val-hdtp', 'hitDeformStretchPinch',     true);
    // 局部凹陷（shader 细节）
    bindSlider('inp-hddd', 'val-hddd', 'hitDeformDentDepth',        true);
    bindSlider('inp-hddr', 'val-hddr', 'hitDeformDentRadius',       true);
    // 击退/眩晕
    bindSlider('inp-hkf',  'val-hkf',  'hitKnockbackForce',         true);
    bindSlider('inp-hsd',  'val-hsd',  'hitStunDuration',           true);
    // 击退弯曲（bend，独立弹簧通道）
    bindSlider('inp-hbs',   'val-hbs',   'hitBendStiffness',         false);
    bindSlider('inp-hbm',   'val-hbm',   'hitBendDamping',           true);
    bindSlider('inp-hbu',   'val-hbu',   'hitBendDuration',          true);
    bindSlider('inp-hbfr',  'val-hbfr',  'hitBendForceRef',          true);
    bindSlider('inp-hbim',  'val-hbim',  'hitBendImpulseMax',        true);
    bindSlider('inp-hbbg',  'val-hbbg',  'hitBendBulge',             true);
    bindSlider('inp-hbcv',  'val-hbcv',  'hitBendCurvature',         true);
    bindSlider('inp-hbsh',  'val-hbsh',  'hitBendShear',             true);
    bindSlider('inp-hbpi',  'val-hbpi',  'hitBendPushIn',            true);
    bindSlider('inp-hbal',  'val-hbal',  'hitBendAxisLength',        true);

    // ✨ 击中流星火花特效 (HitSparkEffect)
    bindSlider('inp-hsv1', 'val-hsv1', 'hitSparkSpeedMin',     true);
    bindSlider('inp-hsv2', 'val-hsv2', 'hitSparkSpeedMax',     true);
    bindSlider('inp-hsdr', 'val-hsdr', 'hitSparkDrag',         true);
    bindSlider('inp-hsgr', 'val-hsgr', 'hitSparkGravity',      true);
    bindSlider('inp-hsca', 'val-hsca', 'hitSparkConeAngle',    true);
    bindSlider('inp-hsvd', 'val-hsvd', 'hitSparkVerticalDamp', true);
    bindSlider('inp-hsub', 'val-hsub', 'hitSparkUpwardBias',   true);
    bindSlider('inp-hslt', 'val-hslt', 'hitSparkLifetime',     true);
    bindSlider('inp-hsvs', 'val-hsvs', 'hitSparkVanishStart',  true);
    bindSlider('inp-hssc', 'val-hssc', 'hitSparkStreakCount',  false);
    bindSlider('inp-hsec', 'val-hsec', 'hitSparkEmberCount',   false);
    bindSlider('inp-hsth', 'val-hsth', 'hitSparkThickness',    true);
    bindSlider('inp-hsln', 'val-hsln', 'hitSparkLength',       true);
    // 方向反转开关（1/0 整数开关，沿用 recallHitBurstEnabled 的模式存为 boolean）
    {
        const rvInput = document.getElementById('inp-hsrv');
        const rvVal   = document.getElementById('val-hsrv');
        if (rvInput && rvVal) {
            rvInput.value = CONFIG.hitSparkReverseDir ? 1 : 0;
            rvVal.innerText = CONFIG.hitSparkReverseDir ? '1' : '0';
            rvInput.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
            rvInput.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10) === 1;
                CONFIG.hitSparkReverseDir = v;
                rvVal.innerText = v ? '1' : '0';
            });
        }
    }

    // 🌠 出手瞬间流星火花特效 (复用 HitSparkEffect，参数完全独立)
    {
        // 总开关
        const enInput = document.getElementById('inp-asen');
        const enVal   = document.getElementById('val-asen');
        if (enInput && enVal) {
            enInput.value = CONFIG.attackSparkEnabled ? 1 : 0;
            enVal.innerText = CONFIG.attackSparkEnabled ? '1' : '0';
            enInput.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
            enInput.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10) === 1;
                CONFIG.attackSparkEnabled = v;
                enVal.innerText = v ? '1' : '0';
            });
        }
        // 方向反转开关
        const rvInput = document.getElementById('inp-asrv');
        const rvVal   = document.getElementById('val-asrv');
        if (rvInput && rvVal) {
            rvInput.value = CONFIG.attackSparkReverseDir ? 1 : 0;
            rvVal.innerText = CONFIG.attackSparkReverseDir ? '1' : '0';
            rvInput.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
            rvInput.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10) === 1;
                CONFIG.attackSparkReverseDir = v;
                rvVal.innerText = v ? '1' : '0';
            });
        }
    }
    bindSlider('inp-assc',  'val-assc',  'attackSparkScale',         true);
    bindSlider('inp-asscs', 'val-asscs', 'attackSparkScaleSpecial',  true);
    bindSlider('inp-asv1',  'val-asv1',  'attackSparkSpeedMin',      true);
    bindSlider('inp-asv2',  'val-asv2',  'attackSparkSpeedMax',      true);
    bindSlider('inp-asdr',  'val-asdr',  'attackSparkDrag',          true);
    bindSlider('inp-asgr',  'val-asgr',  'attackSparkGravity',       true);
    bindSlider('inp-asca',  'val-asca',  'attackSparkConeAngle',     true);
    bindSlider('inp-asvd',  'val-asvd',  'attackSparkVerticalDamp',  true);
    bindSlider('inp-asub',  'val-asub',  'attackSparkUpwardBias',    true);
    bindSlider('inp-aslt',  'val-aslt',  'attackSparkLifetime',      true);
    bindSlider('inp-asvs',  'val-asvs',  'attackSparkVanishStart',   true);
    bindSlider('inp-asssc', 'val-asssc', 'attackSparkStreakCount',   false);
    bindSlider('inp-asec',  'val-asec',  'attackSparkEmberCount',    false);
    bindSlider('inp-asth',  'val-asth',  'attackSparkThickness',     true);
    bindSlider('inp-asln',  'val-asln',  'attackSparkLength',        true);

    // 💥 回收命中爆体特效（EnemyHitBurstEffect）
    // 总开关 + 共用参数
    {
        // 1/0 整数开关单独处理：把布尔保存为 boolean，UI 显示 "1"/"0"
        const enInput = document.getElementById('inp-rhben');
        const enVal   = document.getElementById('val-rhben');
        if (enInput && enVal) {
            enInput.value = CONFIG.recallHitBurstEnabled ? 1 : 0;
            enVal.innerText = CONFIG.recallHitBurstEnabled ? '1' : '0';
            enInput.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
            enInput.addEventListener('input', (e) => {
                const v = parseInt(e.target.value, 10) === 1;
                CONFIG.recallHitBurstEnabled = v;
                enVal.innerText = v ? '1' : '0';
            });
        }
    }
    bindSlider('inp-rhbsc',     'val-rhbsc',     'recallHitBurstScale',          true);
    bindSlider('inp-rhboy',     'val-rhboy',     'recallHitBurstOriginY',        true);
    // 合并机制
    bindSlider('inp-rhbmw',     'val-rhbmw',     'recallHitBurstMergeWindow',    true);
    bindSlider('inp-rhbcm',     'val-rhbcm',     'recallHitBurstCountForMax',    false);
    bindSlider('inp-rhbcv',     'val-rhbcv',     'recallHitBurstCountCurve',     false);
    // 低位密集组（@1 / @max 双端点）
    bindSlider('inp-rhblc',        'val-rhblc',        'recallHitBurstLowCount',            false);
    bindSlider('inp-rhblc-mx',     'val-rhblc-mx',     'recallHitBurstLowCountAtMax',       false);
    bindSlider('inp-rhblsmin',     'val-rhblsmin',     'recallHitBurstLowSpeedMin',         true);
    bindSlider('inp-rhblsmin-mx',  'val-rhblsmin-mx',  'recallHitBurstLowSpeedMinAtMax',    true);
    bindSlider('inp-rhblsmax',     'val-rhblsmax',     'recallHitBurstLowSpeedMax',         true);
    bindSlider('inp-rhblsmax-mx',  'val-rhblsmax-mx',  'recallHitBurstLowSpeedMaxAtMax',    true);
    bindSlider('inp-rhblub',       'val-rhblub',       'recallHitBurstLowUpBias',           true);
    bindSlider('inp-rhblub-mx',    'val-rhblub-mx',    'recallHitBurstLowUpBiasAtMax',      true);
    bindSlider('inp-rhblg',        'val-rhblg',        'recallHitBurstLowGravity',          true);
    bindSlider('inp-rhblg-mx',     'val-rhblg-mx',     'recallHitBurstLowGravityAtMax',     true);
    bindSlider('inp-rhbldr',       'val-rhbldr',       'recallHitBurstLowDrag',             true);
    bindSlider('inp-rhbldr-mx',    'val-rhbldr-mx',    'recallHitBurstLowDragAtMax',        true);
    bindSlider('inp-rhbllmin',     'val-rhbllmin',     'recallHitBurstLowLifeMin',          true);
    bindSlider('inp-rhbllmin-mx',  'val-rhbllmin-mx',  'recallHitBurstLowLifeMinAtMax',     true);
    bindSlider('inp-rhbllmax',     'val-rhbllmax',     'recallHitBurstLowLifeMax',          true);
    bindSlider('inp-rhbllmax-mx',  'val-rhbllmax-mx',  'recallHitBurstLowLifeMaxAtMax',     true);
    bindSlider('inp-rhblzmin',     'val-rhblzmin',     'recallHitBurstLowSizeMin',          true);
    bindSlider('inp-rhblzmin-mx',  'val-rhblzmin-mx',  'recallHitBurstLowSizeMinAtMax',     true);
    bindSlider('inp-rhblzmax',     'val-rhblzmax',     'recallHitBurstLowSizeMax',          true);
    bindSlider('inp-rhblzmax-mx',  'val-rhblzmax-mx',  'recallHitBurstLowSizeMaxAtMax',     true);
    bindSlider('inp-rhblop',       'val-rhblop',       'recallHitBurstLowOpacity',          true);
    bindSlider('inp-rhblop-mx',    'val-rhblop-mx',    'recallHitBurstLowOpacityAtMax',     true);
    bindSlider('inp-rhblcj',       'val-rhblcj',       'recallHitBurstLowColorJitter',      true);
    bindSlider('inp-rhblcj-mx',    'val-rhblcj-mx',    'recallHitBurstLowColorJitterAtMax', true);
    bindSlider('inp-rhblsp',       'val-rhblsp',       'recallHitBurstLowSpin',             true);
    bindSlider('inp-rhblsp-mx',    'val-rhblsp-mx',    'recallHitBurstLowSpinAtMax',        true);
    // 高位稀疏组（@1 / @max 双端点）
    bindSlider('inp-rhbhc',        'val-rhbhc',        'recallHitBurstHighCount',            false);
    bindSlider('inp-rhbhc-mx',     'val-rhbhc-mx',     'recallHitBurstHighCountAtMax',       false);
    bindSlider('inp-rhbhsmin',     'val-rhbhsmin',     'recallHitBurstHighSpeedMin',         true);
    bindSlider('inp-rhbhsmin-mx',  'val-rhbhsmin-mx',  'recallHitBurstHighSpeedMinAtMax',    true);
    bindSlider('inp-rhbhsmax',     'val-rhbhsmax',     'recallHitBurstHighSpeedMax',         true);
    bindSlider('inp-rhbhsmax-mx',  'val-rhbhsmax-mx',  'recallHitBurstHighSpeedMaxAtMax',    true);
    bindSlider('inp-rhbhub',       'val-rhbhub',       'recallHitBurstHighUpBias',           true);
    bindSlider('inp-rhbhub-mx',    'val-rhbhub-mx',    'recallHitBurstHighUpBiasAtMax',      true);
    bindSlider('inp-rhbhg',        'val-rhbhg',        'recallHitBurstHighGravity',          true);
    bindSlider('inp-rhbhg-mx',     'val-rhbhg-mx',     'recallHitBurstHighGravityAtMax',     true);
    bindSlider('inp-rhbhdr',       'val-rhbhdr',       'recallHitBurstHighDrag',             true);
    bindSlider('inp-rhbhdr-mx',    'val-rhbhdr-mx',    'recallHitBurstHighDragAtMax',        true);
    bindSlider('inp-rhbhlmin',     'val-rhbhlmin',     'recallHitBurstHighLifeMin',          true);
    bindSlider('inp-rhbhlmin-mx',  'val-rhbhlmin-mx',  'recallHitBurstHighLifeMinAtMax',     true);
    bindSlider('inp-rhbhlmax',     'val-rhbhlmax',     'recallHitBurstHighLifeMax',          true);
    bindSlider('inp-rhbhlmax-mx',  'val-rhbhlmax-mx',  'recallHitBurstHighLifeMaxAtMax',     true);
    bindSlider('inp-rhbhzmin',     'val-rhbhzmin',     'recallHitBurstHighSizeMin',          true);
    bindSlider('inp-rhbhzmin-mx',  'val-rhbhzmin-mx',  'recallHitBurstHighSizeMinAtMax',     true);
    bindSlider('inp-rhbhzmax',     'val-rhbhzmax',     'recallHitBurstHighSizeMax',          true);
    bindSlider('inp-rhbhzmax-mx',  'val-rhbhzmax-mx',  'recallHitBurstHighSizeMaxAtMax',     true);
    bindSlider('inp-rhbhop',       'val-rhbhop',       'recallHitBurstHighOpacity',          true);
    bindSlider('inp-rhbhop-mx',    'val-rhbhop-mx',    'recallHitBurstHighOpacityAtMax',     true);
    bindSlider('inp-rhbhcj',       'val-rhbhcj',       'recallHitBurstHighColorJitter',      true);
    bindSlider('inp-rhbhcj-mx',    'val-rhbhcj-mx',    'recallHitBurstHighColorJitterAtMax', true);
    bindSlider('inp-rhbhsp',       'val-rhbhsp',       'recallHitBurstHighSpin',             true);
    bindSlider('inp-rhbhsp-mx',    'val-rhbhsp-mx',    'recallHitBurstHighSpinAtMax',        true);

    // ===== 曲线模式（方案 B）：3 根语义曲线整合 52 个 *AtMax 参数 =====
    setupRecallHitBurstCurves();

    // ⚔️ 敌人死亡刀光闪现特效（SlashFlashEffect）
    bindSlider('inp-sfdu',  'val-sfdu',  'slashFlashDuration',        true);
    bindSlider('inp-sfln',  'val-sfln',  'slashFlashLength',          true);
    bindSlider('inp-sfgw',  'val-sfgw',  'slashFlashGlowWidth',       true);
    bindSlider('inp-sfcw',  'val-sfcw',  'slashFlashCoreWidth',       true);
    bindSlider('inp-sfclr', 'val-sfclr', 'slashFlashCoreLengthRatio', true);
    bindSlider('inp-sfho',  'val-sfho',  'slashFlashHeightOffset',    true);
    bindSlider('inp-sfgop', 'val-sfgop', 'slashFlashGlowOpacity',     true);
    bindSlider('inp-sfcop', 'val-sfcop', 'slashFlashCoreOpacity',     true);
    bindSlider('inp-sfrv',  'val-sfrv',  'slashFlashRevealRatio',     true);
    bindSlider('inp-sffs',  'val-sffs',  'slashFlashFadeStart',       true);
    // 颜色（hex 文本输入框，#RRGGBB）— 单独处理：不是 slider
    {
        const colorInput = document.getElementById('inp-sfcl');
        const colorVal   = document.getElementById('val-sfcl');
        if (colorInput && colorVal) {
            const toHexStr = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
            colorInput.value = toHexStr(CONFIG.slashFlashColor ?? 0x91c53a);
            colorVal.innerText = colorInput.value;
            colorInput.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
            colorInput.addEventListener('input', (e) => {
                const s = e.target.value;
                const m = /^#([0-9a-fA-F]{6})$/.exec(s);
                if (m) {
                    CONFIG.slashFlashColor = parseInt(m[1], 16);
                    colorVal.innerText = s.toLowerCase();
                }
            });
        }
    }

    // 🪵 木桩受击反馈 · 形变 + pivot 弯曲（木桩独有，与敌人受击反馈完全独立）
    // 注：闪白和击退/眩晕仍与敌人共用 hit*，在上面那组里。
    // —— Squash & Stretch 形变（stakeDeform*，与 hitDeform* 互不影响）——
    bindSlider('inp-sds',   'val-sds',   'stakeDeformStiffness',      false);
    bindSlider('inp-sdm',   'val-sdm',   'stakeDeformDamping',        true);
    bindSlider('inp-sdu',   'val-sdu',   'stakeDeformDuration',       true);
    bindSlider('inp-sdsa',  'val-sdsa',  'stakeDeformSquashAxis',     true);
    bindSlider('inp-sdsb',  'val-sdsb',  'stakeDeformSquashBulge',    true);
    bindSlider('inp-sdta',  'val-sdta',  'stakeDeformStretchAxis',    true);
    bindSlider('inp-sdtp',  'val-sdtp',  'stakeDeformStretchPinch',   true);
    bindSlider('inp-sdvs',  'val-sdvs',  'stakeDeformVerticalScale',  true);
    // —— pivot 弯曲（stakeBend*）——
    bindSlider('inp-sbs',   'val-sbs',   'stakeBendStiffness',        false);
    bindSlider('inp-sbd',   'val-sbd',   'stakeBendDamping',          true);
    bindSlider('inp-sbma',  'val-sbma',  'stakeBendMaxAngle',         true);
    bindSlider('inp-sbil',  'val-sbil',  'stakeBendImpulseLow',       true);
    bindSlider('inp-sbih',  'val-sbih',  'stakeBendImpulseHigh',      true);
    bindSlider('inp-sbis',  'val-sbis',  'stakeBendImpulseSpecial',   true);
    bindSlider('inp-sbks',  'val-sbks',  'stakeKnockbackBendScale',   true);

    // 🗿 柱状敌人 · 血量（数字输入框，0~10000）+ 攻击节奏与子弹参数
    bindNumber('inp-pehp', 'pillarEnemyHP');
    bindSlider('inp-pefid', 'val-pefid', 'pillarEnemyFireInitDelay', true);
    bindSlider('inp-pefi',  'val-pefi',  'pillarEnemyFireInterval',  true);
    bindSlider('inp-pefw',  'val-pefw',  'pillarEnemyFireWindup',    true);
    bindSlider('inp-pbsp',  'val-pbsp',  'pillarBulletSpeed',        true);
    bindSlider('inp-pblt',  'val-pblt',  'pillarBulletLifetime',     true);
    bindSlider('inp-pbr',   'val-pbr',   'pillarBulletRadius',       true);
    bindSlider('inp-w4pc',  'val-w4pc',  'wave4PillarCount',         false);
    
    const inpDsz = document.getElementById('inp-dsz');
    if (inpDsz) {
        if (CONFIG.damageTextScale !== undefined) {
            inpDsz.value = CONFIG.damageTextScale;
            document.getElementById('val-dsz').innerText = CONFIG.damageTextScale.toFixed(1);
            document.documentElement.style.setProperty('--dmg-scale', CONFIG.damageTextScale); 
        }
        inpDsz.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.damageTextScale = val;
            document.getElementById('val-dsz').innerText = val.toFixed(1);
            document.documentElement.style.setProperty('--dmg-scale', val); 
        });
    }
    
    const inpHsz = document.getElementById('inp-hsz');
    if (inpHsz) {
        if (CONFIG.hudScale !== undefined) {
            inpHsz.value = CONFIG.hudScale;
            document.getElementById('val-hsz').innerText = CONFIG.hudScale.toFixed(1);
            document.documentElement.style.setProperty('--hud-scale', CONFIG.hudScale); 
        }
        inpHsz.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            CONFIG.hudScale = val;
            document.getElementById('val-hsz').innerText = val.toFixed(1);
            document.documentElement.style.setProperty('--hud-scale', val); 
        });
    }

    // ===== 伤害数字动效 · 主动攻击组 =====
    bindSlider('inp-dmg-atk-life', 'val-dmg-atk-life', 'dmgAtkLife',          true);
    bindSlider('inp-dmg-atk-mt',   'val-dmg-atk-mt',   'dmgAtkMoveTimeRatio', true);
    bindSlider('inp-dmg-atk-hr',   'val-dmg-atk-hr',   'dmgAtkHoldRatio',     true);
    bindSlider('inp-dmg-atk-fr',   'val-dmg-atk-fr',   'dmgAtkFadeRatio',     true);
    bindSlider('inp-dmg-atk-dmin', 'val-dmg-atk-dmin', 'dmgAtkBurstDistMin',  true);
    bindSlider('inp-dmg-atk-dmax', 'val-dmg-atk-dmax', 'dmgAtkBurstDistMax',  true);
    bindSlider('inp-dmg-atk-umin', 'val-dmg-atk-umin', 'dmgAtkBurstUpMin',    true);
    bindSlider('inp-dmg-atk-umax', 'val-dmg-atk-umax', 'dmgAtkBurstUpMax',    true);
    bindSlider('inp-dmg-atk-ss',   'val-dmg-atk-ss',   'dmgAtkScaleStart',    true);
    bindSlider('inp-dmg-atk-sp',   'val-dmg-atk-sp',   'dmgAtkScalePunch',    true);
    bindSlider('inp-dmg-atk-sh',   'val-dmg-atk-sh',   'dmgAtkScaleHold',     true);
    bindSlider('inp-dmg-atk-se',   'val-dmg-atk-se',   'dmgAtkScaleEnd',      true);
    bindSlider('inp-dmg-atk-sa0',  'val-dmg-atk-sa0',  'dmgAtkShakeAmpStart', true);
    bindSlider('inp-dmg-atk-sam',  'val-dmg-atk-sam',  'dmgAtkShakeAmpMid',   true);
    bindSlider('inp-dmg-atk-sa1',  'val-dmg-atk-sa1',  'dmgAtkShakeAmpEnd',   true);
    bindSlider('inp-dmg-atk-sac',  'val-dmg-atk-sac',  'dmgAtkShakeAppearCurve', true);
    bindSlider('inp-dmg-atk-sec',  'val-dmg-atk-sec',  'dmgAtkShakeEndCurve', true);
    bindSlider('inp-dmg-atk-dj',   'val-dmg-atk-dj',   'dmgAtkDirJitterDeg');

    // 主动攻击 · 逐字"从天而降"动效（单端点：Start = 第一个字符，End = 最后一个字符）
    bindSlider('inp-dmg-atk-cse',  'val-dmg-atk-cse',  'dmgAtkCharStaggerEnabled');       // 0/1
    bindSlider('inp-dmg-atk-cgs',  'val-dmg-atk-cgs',  'dmgAtkCharGapStart',  true);
    bindSlider('inp-dmg-atk-cge',  'val-dmg-atk-cge',  'dmgAtkCharGapEnd',    true);
    bindSlider('inp-dmg-atk-cds',  'val-dmg-atk-cds',  'dmgAtkCharDurStart',  true);
    bindSlider('inp-dmg-atk-cde',  'val-dmg-atk-cde',  'dmgAtkCharDurEnd',    true);
    bindSlider('inp-dmg-atk-cps',  'val-dmg-atk-cps',  'dmgAtkCharPeakStart', true);
    bindSlider('inp-dmg-atk-cpe',  'val-dmg-atk-cpe',  'dmgAtkCharPeakEnd',   true);

    // ===== 暴击 (Critical Hit · 仅主动攻击) =====
    // 核心参数（开关 / 概率 / 固定伤害 / 击退）
    bindSlider('inp-crit-en',  'val-crit-en',  'critEnabled');                  // 0/1
    bindSlider('inp-crit-ch',  'val-crit-ch',  'critChance',          true);
    bindSlider('inp-crit-dmg', 'val-crit-dmg', 'critDamage');                   // 整数
    bindSlider('inp-crit-kb',  'val-crit-kb',  'critKnockbackForce',  true);
    // 暴击粒子（复用回收命中爆体）
    bindSlider('inp-crit-bs',  'val-crit-bs',  'critBurstScale',      true);
    bindSlider('inp-crit-bmc', 'val-crit-bmc', 'critBurstMergeCount');          // 整数

    // 暴击 · 伤害数字动效（与 dmgAtk* 一一对应的独立分组 dmgCritAtk*）
    bindSlider('inp-dmg-crit-life', 'val-dmg-crit-life', 'dmgCritAtkLife',          true);
    bindSlider('inp-dmg-crit-mt',   'val-dmg-crit-mt',   'dmgCritAtkMoveTimeRatio', true);
    bindSlider('inp-dmg-crit-hr',   'val-dmg-crit-hr',   'dmgCritAtkHoldRatio',     true);
    bindSlider('inp-dmg-crit-fr',   'val-dmg-crit-fr',   'dmgCritAtkFadeRatio',     true);
    bindSlider('inp-dmg-crit-dmin', 'val-dmg-crit-dmin', 'dmgCritAtkBurstDistMin',  true);
    bindSlider('inp-dmg-crit-dmax', 'val-dmg-crit-dmax', 'dmgCritAtkBurstDistMax',  true);
    bindSlider('inp-dmg-crit-umin', 'val-dmg-crit-umin', 'dmgCritAtkBurstUpMin',    true);
    bindSlider('inp-dmg-crit-umax', 'val-dmg-crit-umax', 'dmgCritAtkBurstUpMax',    true);
    bindSlider('inp-dmg-crit-ss',   'val-dmg-crit-ss',   'dmgCritAtkScaleStart',    true);
    bindSlider('inp-dmg-crit-sp',   'val-dmg-crit-sp',   'dmgCritAtkScalePunch',    true);
    bindSlider('inp-dmg-crit-sh',   'val-dmg-crit-sh',   'dmgCritAtkScaleHold',     true);
    bindSlider('inp-dmg-crit-se',   'val-dmg-crit-se',   'dmgCritAtkScaleEnd',      true);
    bindSlider('inp-dmg-crit-sa0',  'val-dmg-crit-sa0',  'dmgCritAtkShakeAmpStart', true);
    bindSlider('inp-dmg-crit-sam',  'val-dmg-crit-sam',  'dmgCritAtkShakeAmpMid',   true);
    bindSlider('inp-dmg-crit-sa1',  'val-dmg-crit-sa1',  'dmgCritAtkShakeAmpEnd',   true);
    bindSlider('inp-dmg-crit-sac',  'val-dmg-crit-sac',  'dmgCritAtkShakeAppearCurve', true);
    bindSlider('inp-dmg-crit-sec',  'val-dmg-crit-sec',  'dmgCritAtkShakeEndCurve', true);
    bindSlider('inp-dmg-crit-dj',   'val-dmg-crit-dj',   'dmgCritAtkDirJitterDeg');
    // 暴击 · 逐字进入动效
    bindSlider('inp-dmg-crit-cse',  'val-dmg-crit-cse',  'dmgCritAtkCharStaggerEnabled'); // 0/1
    bindSlider('inp-dmg-crit-cgs',  'val-dmg-crit-cgs',  'dmgCritAtkCharGapStart',  true);
    bindSlider('inp-dmg-crit-cge',  'val-dmg-crit-cge',  'dmgCritAtkCharGapEnd',    true);
    bindSlider('inp-dmg-crit-cds',  'val-dmg-crit-cds',  'dmgCritAtkCharDurStart',  true);
    bindSlider('inp-dmg-crit-cde',  'val-dmg-crit-cde',  'dmgCritAtkCharDurEnd',    true);
    bindSlider('inp-dmg-crit-cps',  'val-dmg-crit-cps',  'dmgCritAtkCharPeakStart', true);
    bindSlider('inp-dmg-crit-cpe',  'val-dmg-crit-cpe',  'dmgCritAtkCharPeakEnd',   true);

    // ===== 伤害数字动效 · 回收命中组（含 high / special / 中断回收）=====
    // 命中数加成控制
    bindSlider('inp-dmg-rec-mw',    'val-dmg-rec-mw',    'dmgRecMergeWindow',  true);
    bindSlider('inp-dmg-rec-cmax',  'val-dmg-rec-cmax',  'dmgRecCountForMax');
    bindSlider('inp-dmg-rec-curve', 'val-dmg-rec-curve', 'dmgRecCountCurve');

    // 双端点参数：每项 @1 + @max
    bindSlider('inp-dmg-rec-life',     'val-dmg-rec-life',     'dmgRecLife',          true);
    bindSlider('inp-dmg-rec-life-mx',  'val-dmg-rec-life-mx',  'dmgRecLifeAtMax',     true);
    bindSlider('inp-dmg-rec-mt',       'val-dmg-rec-mt',       'dmgRecMoveTimeRatio', true);
    bindSlider('inp-dmg-rec-mt-mx',    'val-dmg-rec-mt-mx',    'dmgRecMoveTimeRatioAtMax', true);
    bindSlider('inp-dmg-rec-hr',       'val-dmg-rec-hr',       'dmgRecHoldRatio',     true);
    bindSlider('inp-dmg-rec-hr-mx',    'val-dmg-rec-hr-mx',    'dmgRecHoldRatioAtMax', true);
    bindSlider('inp-dmg-rec-fr',       'val-dmg-rec-fr',       'dmgRecFadeRatio',     true);
    bindSlider('inp-dmg-rec-fr-mx',    'val-dmg-rec-fr-mx',    'dmgRecFadeRatioAtMax', true);
    bindSlider('inp-dmg-rec-dmin',     'val-dmg-rec-dmin',     'dmgRecBurstDistMin',  true);
    bindSlider('inp-dmg-rec-dmin-mx',  'val-dmg-rec-dmin-mx',  'dmgRecBurstDistMinAtMax', true);
    bindSlider('inp-dmg-rec-dmax',     'val-dmg-rec-dmax',     'dmgRecBurstDistMax',  true);
    bindSlider('inp-dmg-rec-dmax-mx',  'val-dmg-rec-dmax-mx',  'dmgRecBurstDistMaxAtMax', true);
    bindSlider('inp-dmg-rec-umin',     'val-dmg-rec-umin',     'dmgRecBurstUpMin',    true);
    bindSlider('inp-dmg-rec-umin-mx',  'val-dmg-rec-umin-mx',  'dmgRecBurstUpMinAtMax', true);
    bindSlider('inp-dmg-rec-umax',     'val-dmg-rec-umax',     'dmgRecBurstUpMax',    true);
    bindSlider('inp-dmg-rec-umax-mx',  'val-dmg-rec-umax-mx',  'dmgRecBurstUpMaxAtMax', true);
    bindSlider('inp-dmg-rec-ss',       'val-dmg-rec-ss',       'dmgRecScaleStart',    true);
    bindSlider('inp-dmg-rec-ss-mx',    'val-dmg-rec-ss-mx',    'dmgRecScaleStartAtMax', true);
    bindSlider('inp-dmg-rec-sp',       'val-dmg-rec-sp',       'dmgRecScalePunch',    true);
    bindSlider('inp-dmg-rec-sp-mx',    'val-dmg-rec-sp-mx',    'dmgRecScalePunchAtMax', true);
    bindSlider('inp-dmg-rec-sh',       'val-dmg-rec-sh',       'dmgRecScaleHold',     true);
    bindSlider('inp-dmg-rec-sh-mx',    'val-dmg-rec-sh-mx',    'dmgRecScaleHoldAtMax', true);
    bindSlider('inp-dmg-rec-se',       'val-dmg-rec-se',       'dmgRecScaleEnd',      true);
    bindSlider('inp-dmg-rec-se-mx',    'val-dmg-rec-se-mx',    'dmgRecScaleEndAtMax', true);
    bindSlider('inp-dmg-rec-sa0',      'val-dmg-rec-sa0',      'dmgRecShakeAmpStart', true);
    bindSlider('inp-dmg-rec-sa0-mx',   'val-dmg-rec-sa0-mx',   'dmgRecShakeAmpStartAtMax', true);
    bindSlider('inp-dmg-rec-sam',      'val-dmg-rec-sam',      'dmgRecShakeAmpMid',   true);
    bindSlider('inp-dmg-rec-sam-mx',   'val-dmg-rec-sam-mx',   'dmgRecShakeAmpMidAtMax', true);
    bindSlider('inp-dmg-rec-sa1',      'val-dmg-rec-sa1',      'dmgRecShakeAmpEnd',   true);
    bindSlider('inp-dmg-rec-sa1-mx',   'val-dmg-rec-sa1-mx',   'dmgRecShakeAmpEndAtMax', true);
    bindSlider('inp-dmg-rec-sac',      'val-dmg-rec-sac',      'dmgRecShakeAppearCurve', true);
    bindSlider('inp-dmg-rec-sac-mx',   'val-dmg-rec-sac-mx',   'dmgRecShakeAppearCurveAtMax', true);
    bindSlider('inp-dmg-rec-sec',      'val-dmg-rec-sec',      'dmgRecShakeEndCurve', true);
    bindSlider('inp-dmg-rec-sec-mx',   'val-dmg-rec-sec-mx',   'dmgRecShakeEndCurveAtMax', true);
    bindSlider('inp-dmg-rec-dj',       'val-dmg-rec-dj',       'dmgRecDirJitterDeg');
    bindSlider('inp-dmg-rec-dj-mx',    'val-dmg-rec-dj-mx',    'dmgRecDirJitterDegAtMax');
    bindSlider('inp-dmg-rec-fu',       'val-dmg-rec-fu',       'dmgRecFallbackUp',    true);
    bindSlider('inp-dmg-rec-fu-mx',    'val-dmg-rec-fu-mx',    'dmgRecFallbackUpAtMax', true);

    // 逐字 Dock 波浪动效（不区分 @1/@max）：开关 + 3 组双端点（前→后）
    bindSlider('inp-dmg-rec-cse',      'val-dmg-rec-cse',      'dmgRecCharStaggerEnabled');       // 0/1
    bindSlider('inp-dmg-rec-cgs',      'val-dmg-rec-cgs',      'dmgRecCharGapStart',    true);
    bindSlider('inp-dmg-rec-cge',      'val-dmg-rec-cge',      'dmgRecCharGapEnd',      true);
    bindSlider('inp-dmg-rec-cds',      'val-dmg-rec-cds',      'dmgRecCharDurStart',    true);
    bindSlider('inp-dmg-rec-cde',      'val-dmg-rec-cde',      'dmgRecCharDurEnd',      true);
    bindSlider('inp-dmg-rec-cps',      'val-dmg-rec-cps',      'dmgRecCharPeakStart',   true);
    bindSlider('inp-dmg-rec-cpe',      'val-dmg-rec-cpe',      'dmgRecCharPeakEnd',     true);

    bindSlider('inp-jvo', 'val-jvo', 'joystickVisualOffset');
    bindSlider('inp-jdz', 'val-jdz', 'joystickDeadZone', true);
    bindSlider('inp-jlr', 'val-jlr', 'joystickLockRadius');
    bindSlider('inp-jft', 'val-jft', 'joystickFastTraverseMs');
    bindSlider('inp-jsf', 'val-jsf', 'joystickSmoothFactor', true);

    // ==========================================================
    // Javelin VFX (Comprehensive — 4 emitters)
    // ==========================================================
    const bindColor = (inputId, valId, configKey) => {
        const input = document.getElementById(inputId);
        const valDisplay = document.getElementById(valId);
        if (!input || !valDisplay) return;
        // 初始化
        if (CONFIG[configKey] !== undefined) {
            const hex = '#' + CONFIG[configKey].toString(16).padStart(6, '0');
            input.value = hex;
            valDisplay.innerText = hex;
        }
        input.addEventListener('input', (e) => {
            const hex = e.target.value;
            CONFIG[configKey] = parseInt(hex.slice(1), 16);
            valDisplay.innerText = hex;
        });
    };

    // 1) Core
    bindSlider('inp-vfxci',  'val-vfxci',  'vfxCoreIntensity',    true);
    bindSlider('inp-vfxcsz', 'val-vfxcsz', 'vfxCoreScaleZ',       true);
    bindSlider('inp-vfxcsx', 'val-vfxcsx', 'vfxCoreScaleX',       true);
    bindSlider('inp-vfxcsy', 'val-vfxcsy', 'vfxCoreScaleY',       true);
    bindSlider('inp-vfxcfp', 'val-vfxcfp', 'vfxCoreFresnelPow',   true);
    bindColor('inp-vfxcc',   'val-vfxcc',  'vfxCoreColor');
    bindColor('inp-vfxcec',  'val-vfxcec', 'vfxCoreEdgeColor');
    bindSlider('inp-vfxcfd', 'val-vfxcfd', 'vfxCoreFadeDuration', true);

    // 1b) Flight Weapon Model
    bindSlider('inp-vfxfms', 'val-vfxfms', 'vfxFlightModelScale', true);

    // 2) Mach Rings
    bindSlider('inp-vfxrsd', 'val-vfxrsd', 'vfxRingSpawnDist',    true);
    bindSlider('inp-vfxrl',  'val-vfxrl',  'vfxRingLife',         true);
    bindSlider('inp-vfxrss', 'val-vfxrss', 'vfxRingStartScale',   true);
    bindSlider('inp-vfxres', 'val-vfxres', 'vfxRingEndScale',     true);
    bindSlider('inp-vfxriv', 'val-vfxriv', 'vfxRingInheritVel',   true);
    bindColor('inp-vfxrc',   'val-vfxrc',  'vfxRingColor');
    bindSlider('inp-vfxri',  'val-vfxri',  'vfxRingIntensity',    true);
    bindSlider('inp-vfxrir', 'val-vfxrir', 'vfxRingInner',        true);
    bindSlider('inp-vfxror', 'val-vfxror', 'vfxRingOuter',        true);
    bindSlider('inp-vfxrsf', 'val-vfxrsf', 'vfxRingSoftness',     true);

    // 3) Ribbon Trail
    bindSlider('inp-vfxtl',  'val-vfxtl',  'vfxTrailLength');
    bindSlider('inp-vfxtw',  'val-vfxtw',  'vfxTrailWidth',       true);
    bindSlider('inp-vfxttw', 'val-vfxttw', 'vfxTrailTailWidth',   true);
    bindSlider('inp-vfxti',  'val-vfxti',  'vfxTrailIntensity',   true);
    bindColor('inp-vfxtch',  'val-vfxtch', 'vfxTrailColorHead');
    bindColor('inp-vfxtct',  'val-vfxtct', 'vfxTrailColorTail');
    bindSlider('inp-vfxtns', 'val-vfxtns', 'vfxTrailNoiseScale',  true);
    bindSlider('inp-vfxtnv', 'val-vfxtnv', 'vfxTrailNoiseSpeed',  true);
    bindSlider('inp-vfxtna', 'val-vfxtna', 'vfxTrailNoiseAmount', true);
    bindSlider('inp-vfxtes', 'val-vfxtes', 'vfxTrailEdgeSoftness',true);
    bindSlider('inp-vfxtfd', 'val-vfxtfd', 'vfxTrailFadeDuration',true);

    // 4) Sparks
    bindSlider('inp-vfxssd', 'val-vfxssd', 'vfxSparkSpawnDist',   true);
    bindSlider('inp-vfxsp',  'val-vfxsp',  'vfxSparkProb',        true);
    bindSlider('inp-vfxsl',  'val-vfxsl',  'vfxSparkLife',        true);
    bindSlider('inp-vfxsbs', 'val-vfxsbs', 'vfxSparkBaseSpeed',   true);
    bindSlider('inp-vfxssr', 'val-vfxssr', 'vfxSparkSpeedRand',   true);
    bindSlider('inp-vfxss',  'val-vfxss',  'vfxSparkSpeed',       true);
    bindSlider('inp-vfxsiv', 'val-vfxsiv', 'vfxSparkInheritVel',  true);
    bindSlider('inp-vfxsca', 'val-vfxsca', 'vfxSparkConeAngle');
    bindSlider('inp-vfxsd',  'val-vfxsd',  'vfxSparkDrag',        true);
    bindSlider('inp-vfxsg',  'val-vfxsg',  'vfxSparkGravity',     true);
    bindSlider('inp-vfxsz',  'val-vfxsz',  'vfxSparkSize',        true);
    bindSlider('inp-vfxsst', 'val-vfxsst', 'vfxSparkStretch',     true);

    bindSlider('inp-vfxsfl', 'val-vfxsfl', 'vfxSparkFlickerLow',  true);

    // ===== 地图配置 =====
    bindSlider('inp-mbnx', 'val-mbnx', 'mapBrickCountX', true);
    bindSlider('inp-mbry', 'val-mbry', 'mapBrickAspectY', true);
    bindSlider('inp-mgw',  'val-mgw',  'mapGapWidth',    true);
    bindSlider('inp-mso',  'val-mso',  'mapStaggerOffset', true);
    bindSlider('inp-mbo',   'val-mbo',   'mapBrickOpacity', true);
    bindSlider('inp-mbga',  'val-mbga',  'mapBrickGradientAngle', false);
    bindSlider('inp-mbgcy', 'val-mbgcy', 'mapBrickGradientCycles', true);
    bindSlider('inp-mbcmp', 'val-mbcmp', 'mapBrickColorMidPos', true);
    bindSlider('inp-mbbo',  'val-mbbo',  'mapBrickBaseOpacity', true);
    // 砖块参数变更后重画纹理
    ['inp-mbnx', 'inp-mbry', 'inp-mgw', 'inp-mso', 'inp-mbo', 'inp-mbga', 'inp-mbgcy', 'inp-mbcmp'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            try { redrawBrickFloorTexture(); } catch (err) { console.warn('redraw brick failed', err); }
        });
    });
    // 衬底透明度变化时刷新 base layer
    const inpMbbo = document.getElementById('inp-mbbo');
    if (inpMbbo) inpMbbo.addEventListener('input', () => {
        try { refreshBrickBaseLayer(); } catch (e) { console.warn('refresh brick base failed', e); }
    });
    // 颜色选择器统一绑定（hex string -> CONFIG[number]）
    const bindColorPicker = (inputId, valId, configKey, defaultHex, onChange) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(valId);
        if (!input || !valEl) return;
        const cur = (typeof CONFIG[configKey] === 'number')
            ? CONFIG[configKey]
            : parseInt(defaultHex.slice(1), 16);
        const initHex = '#' + cur.toString(16).padStart(6, '0');
        input.value = initHex;
        valEl.innerText = initHex;
        input.addEventListener('input', (e) => {
            const hex = e.target.value;
            valEl.innerText = hex;
            CONFIG[configKey] = parseInt(hex.slice(1), 16);
            try { onChange?.(); } catch (err) { console.warn('color picker callback failed', err); }
        });
    };
    bindColorPicker('inp-mbcs', 'val-mbcs', 'mapBrickColorStart', '#312c5c', () => redrawBrickFloorTexture());
    bindColorPicker('inp-mbcm', 'val-mbcm', 'mapBrickColorMid',   '#6f5fa0', () => redrawBrickFloorTexture());
    bindColorPicker('inp-mbce', 'val-mbce', 'mapBrickColorEnd',   '#91c53a', () => redrawBrickFloorTexture());
    bindColorPicker('inp-mbgc', 'val-mbgc', 'mapBrickGapColor',   '#110f22', () => redrawBrickFloorTexture());
    bindColorPicker('inp-mbbc', 'val-mbbc', 'mapBrickBaseColor',  '#2d2952', () => refreshBrickBaseLayer());

    const btnSaveCfg = document.getElementById('btn-save-cfg');
    if (btnSaveCfg) {
        btnSaveCfg.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            try {
                localStorage.setItem('arrowProjectConfig', JSON.stringify(CONFIG));
                const originalText = btnSaveCfg.innerText;
                btnSaveCfg.innerText = '保存成功！';
                btnSaveCfg.style.background = '#218838';
                setTimeout(() => {
                    btnSaveCfg.innerText = originalText;
                    btnSaveCfg.style.background = '#28a745';
                }, 1500);
            } catch (e) {
                console.error('Failed to save config to localStorage', e);
                btnSaveCfg.innerText = '保存失败';
                btnSaveCfg.style.background = '#dc3545';
                setTimeout(() => {
                    btnSaveCfg.innerText = '将当前参数设置为默认参数';
                    btnSaveCfg.style.background = '#28a745';
                }, 1500);
            }
        });
    }

    // --- Preset Management System ---
    const inpSaveName = document.getElementById('inp-save-name');
    const btnSavePreset = document.getElementById('btn-save-preset');
    const selPresetList = document.getElementById('sel-preset-list');
    const btnLoadPreset = document.getElementById('btn-load-preset');
    const btnDelPreset = document.getElementById('btn-del-preset');
    const btnExportPreset = document.getElementById('btn-export-preset');
    const btnImportPreset = document.getElementById('btn-import-preset');
    const inpImportPreset = document.getElementById('inp-import-preset');

    const PRESETS_STORAGE_KEY = 'arrowProjectPresets';
    let builtInPresets = {};

    const getPresets = () => {
        try {
            const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error('Failed to get presets', e);
            return {};
        }
    };

    const savePresets = (presets) => {
        try {
            localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
        } catch (e) {
            console.error('Failed to save presets', e);
        }
    };

    const refreshPresetList = () => {
        if (!selPresetList) return;
        const customPresets = getPresets();
        
        selPresetList.innerHTML = '<option value="">-- 选择要加载的存档 --</option>';
        
        if (Object.keys(builtInPresets).length > 0) {
            const groupBuiltIn = document.createElement('optgroup');
            groupBuiltIn.label = '内置存档 (不可删改)';
            for (const name in builtInPresets) {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ type: 'builtin', name });
                opt.innerText = name;
                groupBuiltIn.appendChild(opt);
            }
            selPresetList.appendChild(groupBuiltIn);
        }

        if (Object.keys(customPresets).length > 0) {
            const groupCustom = document.createElement('optgroup');
            groupCustom.label = '自定义存档 (本地缓存)';
            for (const name in customPresets) {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ type: 'custom', name });
                opt.innerText = name;
                groupCustom.appendChild(opt);
            }
            selPresetList.appendChild(groupCustom);
        }
    };

    const fetchBuiltInPresets = async () => {
        try {
            const res = await fetch('./src/presets/manifest.json');
            if (!res.ok) return;
            const files = await res.json();
            for (const file of files) {
                try {
                    const fileRes = await fetch(`./src/presets/${file}`);
                    if (fileRes.ok) {
                        const data = await fileRes.json();
                        const name = data.type === 'arrowProjectPreset' && data.name ? data.name : file.replace('.json', '');
                        const config = data.type === 'arrowProjectPreset' ? data.config : data;
                        builtInPresets[name] = config;
                    }
                } catch (e) {
                    console.error('Failed to load preset file:', file, e);
                }
            }
            refreshPresetList();
        } catch (e) {
            console.warn('No manifest.json found or failed to load built-in presets.', e);
        }
    };
    fetchBuiltInPresets();

    if (btnSavePreset && inpSaveName) {
        btnSavePreset.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            const name = inpSaveName.value.trim();
            if (!name) {
                alert('请输入存档名称');
                return;
            }
            
            if (builtInPresets[name]) {
                alert(`与内置存档 "${name}" 同名，请使用其他名称！`);
                return;
            }
            
            const presets = getPresets();
            if (presets[name] && !confirm(`存档 "${name}" 已存在，是否覆盖？`)) {
                return;
            }
            
            presets[name] = { ...CONFIG };
            savePresets(presets);
            refreshPresetList();
            
            inpSaveName.value = '';
            // Select the newly saved preset
            selPresetList.value = JSON.stringify({ type: 'custom', name });
            
            const originalText = btnSavePreset.innerText;
            btnSavePreset.innerText = '保存成功';
            btnSavePreset.style.background = '#218838';
            setTimeout(() => {
                btnSavePreset.innerText = originalText;
                btnSavePreset.style.background = '#007bff';
            }, 1500);
        });
    }

    if (btnLoadPreset && selPresetList) {
        btnLoadPreset.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            const val = selPresetList.value;
            if (!val) {
                alert('请先选择一个存档');
                return;
            }
            
            let type, name;
            try {
                const parsed = JSON.parse(val);
                type = parsed.type;
                name = parsed.name;
            } catch(e) { return; }
            
            let presetConfig = type === 'builtin' ? builtInPresets[name] : getPresets()[name];
            
            if (presetConfig) {
                // 拷贝 preset，再做旧伤害数字字段迁移（兼容历史存档）
                const presetCopy = { ...presetConfig };
                migrateDamageTextConfig(presetCopy);

                // Ensure missing properties fallback to default current parameters
                const mergedConfig = { ...DEFAULT_CONFIG, ...presetCopy };
                Object.assign(CONFIG, mergedConfig);
                localStorage.setItem('arrowProjectConfig', JSON.stringify(CONFIG));

                // Need to reload to apply all config changes cleanly
                if (confirm('加载存档成功！是否立即刷新页面以应用？')) {
                    location.reload();
                }
            } else {
                alert('存档数据无效或已损坏');
            }
        });
    }

    if (btnDelPreset && selPresetList) {
        btnDelPreset.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            const val = selPresetList.value;
            if (!val) {
                alert('请先选择一个存档');
                return;
            }
            
            let type, name;
            try {
                const parsed = JSON.parse(val);
                type = parsed.type;
                name = parsed.name;
            } catch(e) { return; }
            
            if (type === 'builtin') {
                alert('内置存档不可删除！');
                return;
            }
            
            if (confirm(`确定要删除存档 "${name}" 吗？`)) {
                const presets = getPresets();
                delete presets[name];
                savePresets(presets);
                refreshPresetList();
            }
        });
    }

    if (btnExportPreset && selPresetList) {
        btnExportPreset.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            const val = selPresetList.value;
            if (!val) {
                alert('请先选择一个存档进行导出');
                return;
            }
            
            let type, name;
            try {
                const parsed = JSON.parse(val);
                type = parsed.type;
                name = parsed.name;
            } catch(e) { return; }
            
            const presetConfig = type === 'builtin' ? builtInPresets[name] : getPresets()[name];
            if (!presetConfig) return;
            
            try {
                // Wrap in a standard format so we know it's a preset when importing
                const exportData = {
                    type: 'arrowProjectPreset',
                    name: name,
                    config: presetConfig
                };
                
                const jsonStr = JSON.stringify(exportData, null, 2);
                const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
                const dataUri = `data:application/json;base64,${base64Str}`;
                
                const a = document.createElement('a');
                a.href = dataUri;
                
                // Format filename based on preset name
                const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                a.download = `arrow_preset_${safeName}.json`;
                
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (e) {
                console.error('Failed to export preset', e);
                alert('导出存档失败');
            }
        });
    }

    if (btnImportPreset && inpImportPreset) {
        btnImportPreset.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            inpImportPreset.click();
        });

        inpImportPreset.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    let nameToSave = importedData.name || 'Imported Preset';
                    let configToSave = importedData.config;
                    
                    // Fallback if someone imports an old direct config export
                    if (importedData.type !== 'arrowProjectPreset' && importedData.shootCooldown !== undefined) {
                        configToSave = importedData;
                        nameToSave = 'Imported Old Config';
                    }
                    
                    if (!configToSave) {
                        throw new Error('Invalid format');
                    }
                    
                    // Prompt user for name, offering the original name as default
                    const finalName = prompt('请输入导入的存档名称：', nameToSave);
                    if (finalName === null) return; // Cancelled
                    
                    const actualName = finalName.trim() || nameToSave;
                    
                    if (builtInPresets[actualName]) {
                        alert(`不能与内置存档同名！`);
                        return;
                    }
                    
                    const presets = getPresets();
                    presets[actualName] = configToSave;
                    savePresets(presets);
                    refreshPresetList();
                    selPresetList.value = JSON.stringify({ type: 'custom', name: actualName });
                    
                    alert(`成功导入存档: "${actualName}"`);
                } catch (err) {
                    console.error('Failed to parse imported preset', err);
                    alert('导入失败：文件格式不正确或已损坏');
                }
            };
            reader.onerror = () => {
                alert('读取文件失败');
            };
            reader.readAsText(file);
            e.target.value = '';
        });
    }

    // ===================================================================
    // 导出"包体默认参数"为 shipping.js 文件
    // ---
    // 用法：在面板里调到满意 → 点这个按钮 → 浏览器下载得到 shipping.js
    //      把文件直接放进 src/presets/ 替换旧文件 → 重新打包 APK 即可。
    // 加载顺序（在 src/config.js 中定义）：
    //   DEFAULT_CONFIG  ←  SHIPPING_PRESET  ←  localStorage
    // 即出厂参数会作为 APK 首启的默认值。
    // ===================================================================
    const btnExportShipping = document.getElementById('btn-export-shipping');
    if (btnExportShipping) {
        btnExportShipping.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();

            try {
                // 把当前运行中的 CONFIG 完整快照（剔除运行时产生的内部字段，不过 CONFIG 里
                // 都是参数，没有内部字段，所以直接用浅拷贝即可）。
                const snapshot = { ...CONFIG };

                // 生成 shipping.js 的源代码字符串
                const fileContent = buildShippingJsFile(snapshot);

                // 触发下载
                const blob = new Blob([fileContent], { type: 'text/javascript;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'shipping.js';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                // 视觉反馈
                const originalText = btnExportShipping.innerText;
                const originalBg = btnExportShipping.style.background;
                btnExportShipping.innerText = '✅ 已下载 shipping.js，请放入 src/presets/ 替换';
                btnExportShipping.style.background = '#28a745';
                setTimeout(() => {
                    btnExportShipping.innerText = originalText;
                    btnExportShipping.style.background = originalBg;
                }, 2200);
            } catch (e) {
                console.error('Failed to export shipping preset', e);
                alert('导出 shipping.js 失败：' + (e?.message || e));
            }
        });
    }

    // Initial load of presets
    refreshPresetList();

    // ===== 左侧分类 Tab 构建 =====
    // 面板布局：左侧 #panel-tabs（固定宽度）+ 右侧 #panel-content（分组列表）。
    // 每个 .panel-group 对应一个 Tab，按钮标签来自 <summary> 文本。
    // 点击 Tab：仅激活当前分组（通过控制 [open] 属性 + .is-active 高亮）。
    // CSS 中已写明 .panel-group:not([open]) { display: none }，
    // 所以同一时刻只有一个分组可见，其它分组从布局中移除。
    const panelTabsEl = document.getElementById('panel-tabs');
    const panelContentEl = document.getElementById('panel-content');
    if (panelTabsEl && panelContentEl) {
        // 清空旧的（防止重复初始化）
        panelTabsEl.innerHTML = '';
        const groups = Array.from(panelContentEl.querySelectorAll('.panel-group'));
        let activeIndex = 0;
        // 找到默认应激活的分组：优先选第一个带 open 的，否则取第一个
        const initialActive = groups.findIndex((g) => g.hasAttribute('open'));
        if (initialActive >= 0) activeIndex = initialActive;

        const tabButtons = [];
        const setActive = (idx) => {
            activeIndex = idx;
            groups.forEach((g, i) => {
                if (i === idx) g.setAttribute('open', '');
                else g.removeAttribute('open');
            });
            tabButtons.forEach((b, i) => {
                b.classList.toggle('is-active', i === idx);
            });
            // 切换分类后，把 #panel-content 滚回顶部，避免之前的滚动位置干扰
            panelContentEl.scrollTop = 0;
        };

        groups.forEach((group, idx) => {
            const summary = group.querySelector(':scope > summary');
            const label = (summary?.textContent || `分类 ${idx + 1}`).trim();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'panel-tab';
            btn.textContent = label;
            btn.addEventListener('click', () => {
                Globals.audioManager?.playUIClick();
                setActive(idx);
            });
            panelTabsEl.appendChild(btn);
            tabButtons.push(btn);
        });

        if (groups.length > 0) setActive(activeIndex);
    }
}

/**
 * 把一个 config 对象渲染成 shipping.js 文件的完整源码字符串。
 * 输出格式与手写的 src/presets/shipping.js 风格保持一致：
 *   - 顶部带注释说明
 *   - 导出 SHIPPING_PRESET_VERSION 与 SHIPPING_PRESET
 *   - 字段名作为合法标识符直接当 key（不加引号）
 *   - 嵌套对象/数组用 JSON 序列化后再缩进
 */
function buildShippingJsFile(configSnapshot) {
    const timestamp = new Date().toISOString();
    const version = (typeof configSnapshot.__shippingVersion === 'number')
        ? configSnapshot.__shippingVersion + 1
        : Math.floor(Date.now() / 1000); // 用秒级时间戳作为版本号兜底

    const header = `// =====================================================================
// 出厂参数 (SHIPPING PRESET) — 自动生成，请勿手动编辑
// ---------------------------------------------------------------------
// 生成时间: ${timestamp}
//
// 这个文件由控制面板里的「导出当前参数为包体默认」按钮自动生成。
// 它定义了"打包发布版本"启动时应用的默认游戏参数。
//
// 加载顺序（在 src/config.js 中实现）：
//
//     DEFAULT_CONFIG  ←  SHIPPING_PRESET  ←  localStorage
//        (硬编码)         (出厂调好的值)      (用户本地修改)
//
//   1. 首先用 DEFAULT_CONFIG 初始化 CONFIG（保证所有字段都有兜底）
//   2. 然后用 SHIPPING_PRESET 覆盖（这一份"调好的参数"应用到出厂状态）
//   3. 最后用 localStorage 中的用户配置覆盖（开发时调过的参数会保留）
//
// 普通用户首次打开 APK 时直接体验到 SHIPPING_PRESET 的参数；
// 开发者在面板里调过的参数仍然会生效（因为 localStorage 优先级最高）。
//
// ---------------------------------------------------------------------
// 维护流程：
//   1. 在控制面板里把参数调到满意
//   2. 点击「导出当前参数为包体默认 (shipping.js)」按钮，下载本文件
//   3. 把下载的 shipping.js 放进 src/presets/ 替换旧文件
//   4. 重新打包 APK
// =====================================================================

export const SHIPPING_PRESET_VERSION = ${version};

export const SHIPPING_PRESET = `;

    const body = serializeAsJsObjectLiteral(configSnapshot, 0);
    return header + body + ';\n';
}

/**
 * 把对象序列化为"JS 对象字面量"字符串。
 * 与 JSON.stringify 的差别：
 *   - 简单标识符（[A-Za-z_$][\w$]*）的 key 不加引号
 *   - 字符串值用双引号包裹（与 JSON 兼容）
 *   - 数字 / 布尔 / null 直接输出
 *   - 嵌套对象 / 数组递归处理
 *   - 末尾保留尾随逗号（JS 合法，git diff 也更友好）
 */
function serializeAsJsObjectLiteral(value, indent) {
    const pad = '    '.repeat(indent);
    const padInner = '    '.repeat(indent + 1);

    if (value === null) return 'null';
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'number') {
        // Number.isFinite 排除 NaN/Infinity（JSON 也不支持）
        return Number.isFinite(value) ? String(value) : 'null';
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return JSON.stringify(value);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(v => padInner + serializeAsJsObjectLiteral(v, indent + 1));
        return '[\n' + items.join(',\n') + ',\n' + pad + ']';
    }

    if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        const lines = keys.map(k => {
            const keyStr = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
            return padInner + keyStr + ': ' + serializeAsJsObjectLiteral(value[k], indent + 1);
        });
        return '{\n' + lines.join(',\n') + ',\n' + pad + '}';
    }

    // 兜底（function/symbol 等不可序列化值）
    return 'null';
}

/**
 * 回收命中爆体特效 — 曲线模式（方案 B）UI 装配
 *   - 总开关 inp-rhbuc：1=曲线模式 / 0=旧滑条模式
 *   - 3 个曲线编辑面板：density / motion / visual
 *   - 切换模式时显隐 *AtMax 旧滑条（通过 data-burst-mode 属性）与曲线面板
 *
 * 自动给所有 inp-rhb*-mx 与 val-rhb*-mx 所在的 .panel-row 打上 data-burst-mode="legacy"，
 * 这样模式切换时能直接基于属性选择，避免修改 90 处 HTML。
 */
function setupRecallHitBurstCurves() {
    // 1) 给所有 *AtMax 滑条的父行打标记
    const legacyRows = new Set();
    document.querySelectorAll('#control-panel input[id^="inp-rhb"][id$="-mx"]').forEach((inp) => {
        const row = inp.closest('.panel-row');
        if (row) {
            row.dataset.burstMode = 'legacy';
            legacyRows.add(row);
        }
    });

    // 2) 模式开关绑定
    const modeInput = document.getElementById('inp-rhbuc');
    const modeVal = document.getElementById('val-rhbuc');
    const applyMode = (useCurves) => {
        CONFIG.recallHitBurstUseCurves = !!useCurves;
        if (modeVal) {
            modeVal.innerText = useCurves ? '1 (曲线)' : '0 (旧滑条)';
            modeVal.style.color = useCurves ? '#cbe88b' : '#ffb27a';
        }
        // legacy 行（@max 滑条）：曲线模式开 → 隐藏；关 → 显示
        document.querySelectorAll('#control-panel [data-burst-mode="legacy"]').forEach((el) => {
            el.style.display = useCurves ? 'none' : '';
        });
        // curves 行：与 legacy 互斥
        document.querySelectorAll('#control-panel [data-burst-mode="curves"]').forEach((el) => {
            el.style.display = useCurves ? '' : 'none';
        });
        // 切换模式时清空场景中残余的爆体特效，避免新旧逻辑产生的粒子混在一起
        if (Globals.enemyHitBurstEffects && Globals.enemyHitBurstEffects.length) {
            for (const eff of Globals.enemyHitBurstEffects) {
                eff.destroy?.();
            }
            Globals.enemyHitBurstEffects.length = 0;
        }
    };
    if (modeInput) {
        modeInput.value = CONFIG.recallHitBurstUseCurves ? 1 : 0;
        modeInput.addEventListener('pointerdown', () => Globals.audioManager?.playUIClick(), { passive: true });
        modeInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) === 1;
            applyMode(v);
        });
    }

    // 3) 三个曲线面板
    const curves = CONFIG.recallHitBurstCurves;
    if (curves) {
        const mountDensity = document.getElementById('bezier-burst-density');
        const mountMotion  = document.getElementById('bezier-burst-motion');
        const mountVisual  = document.getElementById('bezier-burst-visual');
        if (mountDensity) buildCurvePanel(mountDensity, curves.density, { label: '① 数量与寿命 (Count / Life)' });
        if (mountMotion)  buildCurvePanel(mountMotion,  curves.motion,  { label: '② 运动强度 (Speed / UpBias / Gravity / Drag)' });
        if (mountVisual)  buildCurvePanel(mountVisual,  curves.visual,  { label: '③ 视觉强度 (Size / Opacity / Jitter / Spin)' });
    }

    // 4) 应用初始模式（依据 CONFIG 默认 true）
    applyMode(!!CONFIG.recallHitBurstUseCurves);

    // 5) "测试爆发"按钮：在玩家位置触发一次 @max 端点的爆体，
    //    无需找敌人即可立刻验证 @max / endScale 的视觉效果。
    const testBtn = document.getElementById('btn-rhb-test');
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            const player = Globals.player;
            const scene  = Globals.scene;
            if (!player || !scene) {
                console.warn('[burst-test] 玩家或场景未初始化');
                return;
            }
            // 取玩家位置 + 一点抬高（接近敌人身体中段）作为爆点
            const pos = player.mesh ? player.mesh.position.clone() : new THREE.Vector3(0, 0, 0);
            // 颜色用敌人风格的紫色（与 recallHitBurstFixedColor 同款）便于辨识"测试爆"
            const eff = new EnemyHitBurstEffect(pos, 0xff7a00);
            if (!eff.alive) {
                console.warn('[burst-test] 总开关关闭中，请打开 "总开关 (1=开 / 0=关)"');
                return;
            }
            // 强制 mergeCount = CountForMax → 触发 @max / 曲线终点
            const maxCount = Math.max(1, CONFIG.recallHitBurstCountForMax ?? 10);
            eff.addBurst(maxCount);
            Globals.enemyHitBurstEffects.push(eff);
            // 控制台打印当前模式 & 关键参数，便于调参时快速核对
            console.log('[burst-test] 触发爆发：',
                CONFIG.recallHitBurstUseCurves ? '曲线模式' : '旧滑条模式',
                '| mergeCount =', maxCount,
                '| pos =', pos.toArray().map(v => v.toFixed(2)).join(','));
        });
    }
}
