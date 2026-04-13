import { CONFIG, DEFAULT_CONFIG } from '../config.js';
import { Globals } from '../utils.js';
import { clearSceneEntities, refreshBoundaryVisual, refreshCameraFollow } from '../main.js';

const PANEL_VERSION = 'v2026.04.13-1131';

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
            clearSceneEntities();
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
    bindSlider('inp-mmsx', 'val-mmsx', 'maxMoveSpeedX');
    bindSlider('inp-mmsz', 'val-mmsz', 'maxMoveSpeedZ');
    bindSlider('inp-ccr', 'val-ccr', 'customCollisionRadius');
    bindSlider('inp-pbnc', 'val-pbnc', 'playerBounce', true);

    const bindToggle = (inputId, valId, configKey) => {
        const input = document.getElementById(inputId);
        const val = document.getElementById(valId);
        if (CONFIG[configKey] !== undefined) {
            input.checked = !!CONFIG[configKey];
            val.innerText = CONFIG[configKey] ? '开' : '关';
        }
        input.addEventListener('change', (e) => {
            CONFIG[configKey] = e.target.checked;
            val.innerText = e.target.checked ? '开' : '关';
        });
    };

    bindToggle('inp-scb', 'val-scb', 'showCollisionBox');
    bindToggle('inp-spt', 'val-spt', 'showPlayerTrajectory');
    bindToggle('inp-ucc', 'val-ucc', 'useCustomCollision');
    bindToggle('inp-xre', 'val-xre', 'xrayEnabled');
    bindToggle('inp-hvd', 'val-hvd', 'hideVisualDistractors');

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
                // Ensure missing properties fallback to default current parameters
                const mergedConfig = { ...DEFAULT_CONFIG, ...presetConfig };
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
    
    // Initial load of presets
    refreshPresetList();
}
