import { CONFIG } from '../config.js';
import { Globals } from '../utils.js';
import { clearSceneEntities, refreshBoundaryVisual, refreshCameraFollow } from '../main.js';

const PANEL_VERSION = 'v2026.04.09-1034';

export function setupControlPanel() {
    const controlPanel = document.getElementById('control-panel');
    const versionEl = document.getElementById('panel-version');
    if (versionEl) versionEl.innerText = PANEL_VERSION;

    const stopEvent = (e) => e.stopPropagation();
    ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel'].forEach((eventName) => {
        controlPanel?.addEventListener(eventName, stopEvent, { passive: false });
    });

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
        if (!audio) return;
        audioEnabledInput.checked = audio.enabled;
        audioEnabledValue.innerText = audio.enabled ? '开' : '关';
        audioVolumeInput.value = String(audio.volume);
        audioVolumeValue.innerText = audio.volume.toFixed(2);
    };
    syncAudioUi();

    audioEnabledInput.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        CONFIG.audioEnabled = enabled;
        Globals.audioManager?.setEnabled(enabled);
        audioEnabledValue.innerText = enabled ? '开' : '关';
    });

    audioVolumeInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        CONFIG.audioVolume = val;
        Globals.audioManager?.setVolume(val);
        audioVolumeValue.innerText = val.toFixed(2);
    });

    const btnScm = document.getElementById('btn-scm');
    const valScm = document.getElementById('val-scm');
    
    if (CONFIG.sceneMode === 'empty') {
        valScm.innerText = '空旷';
        btnScm.innerText = '切换为无尽';
    } else if (CONFIG.sceneMode === 'obstacles') {
        valScm.innerText = '障碍测试';
        btnScm.innerText = '切换为空旷';
    } else {
        valScm.innerText = '无尽';
        btnScm.innerText = '切换为障碍测试';
    }
    
    btnScm.addEventListener('click', () => {
        Globals.audioManager?.playUIClick();
        if (CONFIG.sceneMode === 'endless') {
            CONFIG.sceneMode = 'obstacles';
            valScm.innerText = '障碍测试';
            btnScm.innerText = '切换为空旷';
            clearSceneEntities();
            refreshBoundaryVisual();
        } else if (CONFIG.sceneMode === 'obstacles') {
            CONFIG.sceneMode = 'empty';
            valScm.innerText = '空旷';
            btnScm.innerText = '切换为无尽';
            clearSceneEntities();
            refreshBoundaryVisual();
        } else {
            CONFIG.sceneMode = 'endless';
            valScm.innerText = '无尽';
            btnScm.innerText = '切换为障碍测试';
            refreshBoundaryVisual();
        }
    });

    const btnFlm = document.getElementById('btn-flm');
    const valFlm = document.getElementById('val-flm');
    const btnCfl = document.getElementById('btn-cfl');
    const valCfl = document.getElementById('val-cfl');
    const btnMfm = document.getElementById('btn-mfm');
    const valMfm = document.getElementById('val-mfm');
    
    if (CONFIG.floorStyle === 'checkerboard') {
        valFlm.innerText = '黑白格子';
        btnFlm.innerText = '切换为纯色';
    } else {
        valFlm.innerText = '纯色';
        btnFlm.innerText = '切换为格子';
    }
    
    btnFlm.addEventListener('click', () => {
        Globals.audioManager?.playUIClick();
        if (CONFIG.floorStyle === 'checkerboard') {
            CONFIG.floorStyle = 'solid';
            valFlm.innerText = '纯色';
            btnFlm.innerText = '切换为格子';
        } else {
            CONFIG.floorStyle = 'checkerboard';
            valFlm.innerText = '黑白格子';
            btnFlm.innerText = '切换为纯色';
        }
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

    const syncMoveFacingModeUi = () => {
        if (CONFIG.moveFacingMode === 'faceMoveDirection') {
            valMfm.innerText = '移动即朝向';
            btnMfm.innerText = '切换为移动/旋转解耦';
        } else {
            valMfm.innerText = '移动/旋转解耦';
            btnMfm.innerText = '切换为移动即朝向';
        }
    };
    syncMoveFacingModeUi();

    btnMfm.addEventListener('click', () => {
        Globals.audioManager?.playUIClick();
        CONFIG.moveFacingMode = CONFIG.moveFacingMode === 'faceMoveDirection' ? 'decoupled' : 'faceMoveDirection';
        syncMoveFacingModeUi();
    });

    const bindSlider = (inputId, valId, configKey, isFloat = false) => {
        const input = document.getElementById(inputId);
        const valDisplay = document.getElementById(valId);
        
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

    bindSlider('inp-sr', 'val-sr', 'shakeIntensityRecall', true);
    bindSlider('inp-si', 'val-si', 'shakeIntensityDeath', true);
    bindSlider('inp-sf', 'val-sf', 'shakeIntensityFinal', true);
    bindSlider('inp-sd', 'val-sd', 'shakeDuration', true);
    bindSlider('inp-bl', 'val-bl', 'bloodLinger', true);

    bindSlider('inp-cd', 'val-cd', 'shootCooldown', true);
    bindSlider('inp-ds', 'val-ds', 'deploySpeed');
    bindSlider('inp-ri', 'val-ri', 'recallInterval');
    bindSlider('inp-rs', 'val-rs', 'baseRecallSpeed');
    bindSlider('inp-frd', 'val-frd', 'finalRecallDelay');
    bindSlider('inp-frs', 'val-frs', 'finalRecallSpeed');
    bindSlider('inp-tdl', 'val-tdl', 'tetherDashLength', true);
    bindSlider('inp-tgl', 'val-tgl', 'tetherGapLength', true);
    bindSlider('inp-ttk', 'val-ttk', 'tetherThickness', true);
    bindSlider('inp-tsc', 'val-tsc', 'tetherSegmentCount');
    bindSlider('inp-stdl', 'val-stdl', 'specialTetherDashLength', true);
    bindSlider('inp-stgl', 'val-stgl', 'specialTetherGapLength', true);
    bindSlider('inp-sttk', 'val-sttk', 'specialTetherThickness', true);
    bindSlider('inp-stsc', 'val-stsc', 'specialTetherSegmentCount');

    bindSlider('inp-tns', 'val-tns', 'turnSpeed');
    bindSlider('inp-mva', 'val-mva', 'moveAcceleration');
    bindSlider('inp-mvf', 'val-mvf', 'moveFriction');
    bindSlider('inp-mms', 'val-mms', 'maxMoveSpeed');

    const inpCvs = document.getElementById('inp-cvs');
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

    const inpBst = document.getElementById('inp-bst');
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

    const inpBth = document.getElementById('inp-bth');
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

    const inpPs = document.getElementById('inp-ps');
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
    
    const inpEs = document.getElementById('inp-es');
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
    
    const inpDsz = document.getElementById('inp-dsz');
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
    
    const inpHsz = document.getElementById('inp-hsz');
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

    const toggleBtn = document.getElementById('toggle-panel');
    const panelContent = document.getElementById('panel-content');
    const panelTabs = document.getElementById('panel-tabs');
    const panelGroups = Array.from(document.querySelectorAll('.panel-group'));

    const setActivePanelGroup = (activeGroup) => {
        panelGroups.forEach((group) => {
            group.open = group === activeGroup;
        });

        Array.from(panelTabs.querySelectorAll('.panel-tab')).forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.target === activeGroup.dataset.panelKey);
        });

        activeGroup.scrollIntoView({ block: 'nearest' });
    };

    panelTabs.innerHTML = '';
    panelGroups.forEach((group, index) => {
        const summary = group.querySelector('summary');
        const label = summary?.textContent?.trim() || `分类 ${index + 1}`;
        const key = `panel-group-${index}`;
        group.dataset.panelKey = key;

        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'panel-tab';
        tab.dataset.target = key;
        tab.innerText = label;
        tab.addEventListener('click', () => {
            Globals.audioManager?.playUIClick();
            setActivePanelGroup(group);
        });
        panelTabs.appendChild(tab);
    });

    const initiallyOpenGroup = panelGroups.find((group) => group.open) || panelGroups[0];
    if (initiallyOpenGroup) setActivePanelGroup(initiallyOpenGroup);

    toggleBtn.addEventListener('click', () => {
        const isHidden = panelContent.style.display === 'none';
        panelContent.style.display = isHidden ? 'flex' : 'none';
        toggleBtn.innerText = isHidden ? '收起' : '展开';
    });

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
}
