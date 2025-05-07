// ==UserScript==
// @name         ZED Insights - Race Module
// @namespace    zed-champions-insights
// @version      1.0.5
// @description  Provides race-specific insights and UI for ZED Champions race pages.
// @author       Your Name/Team
// @match        *://app.zedchampions.com/race/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_setValue // For saving active tab
// @grant        GM_getValue // For restoring active tab
// @resource     raceModuleCSS race-module.css
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('ZED Insights - Race Module Loaded (v1.0.5)');

    const MODULE_VERSION = '1.0.5';
    let ZED_API = null;
    let pageObserver = null;
    const TAB_PREF_KEY = 'raceModuleActiveTab';

    // --- DOM Helper Functions (Migrated) ---
    function getRaceState() {
        const primaryStateSelector = 'p.chakra-text.css-1qihh2w';
        const fallbackStateSelector = 'div.css-13p2d58';
        let stateElement = document.querySelector(primaryStateSelector) || document.querySelector(fallbackStateSelector);
        if (stateElement && stateElement.textContent) {
            const stateText = stateElement.textContent.trim().toUpperCase();
            // console.log(`Race Module: Found race state "${stateText}"`);
            return stateText;
        }
        console.warn(`Race Module: Could not find race state element.`);
        return null;
    }

    function getCurrentRaceInfo(raceState) {
        const mainContainerSelector = 'div.css-1ayvxu3';
        const horseEntrySelector = ':scope > div[class^="css-"]';
        const horseLinkSelector = 'a.chakra-link.css-gu1x9h[href^="/horse/"]';
        const userIndicatorSelector = '.css-1hyybix .css-6v8iix';
        const gateNumberSelector = 'p.chakra-text.css-4ipfhb, p.chakra-text.css-s461m';

        const mainContainer = document.querySelector(mainContainerSelector);
        const horses = [];
        const userHorseIds = new Set();

        if (!mainContainer) {
            console.error(`Race Module: Could not find main horse link container: ${mainContainerSelector}`);
            return { horses: [], userHorseIds: [] };
        }

        const horseElements = mainContainer.querySelectorAll(horseEntrySelector);
        
        horseElements.forEach((horseDiv, index) => {
            const linkElement = horseDiv.querySelector(horseLinkSelector);
            const gateElement = horseDiv.querySelector(gateNumberSelector);
            
            let horseId = null, horseName = 'Unknown Horse', gate = null, isUser = false;
            const currentAugments = [];

            if (linkElement && linkElement.href) {
                const hrefParts = linkElement.href.split('/');
                horseId = hrefParts[hrefParts.length - 1];
                horseName = linkElement.textContent ? linkElement.textContent.trim() : 'Unnamed Horse';
            } else { 
                console.warn(`Race Module: Skipping horse at index ${index}, no link/ID.`);
                return; 
            }

            if (gateElement && gateElement.textContent) {
                const match = gateElement.textContent.match(/\d+/);
                if (match) gate = parseInt(match[0], 10);
            }

            if (linkElement.querySelector(userIndicatorSelector)) {
                isUser = true; userHorseIds.add(horseId);
            }

            const augOuterContainer = horseDiv.querySelector('div.css-102lqhp');
            if (augOuterContainer) {
                const augmentDivs = augOuterContainer.querySelectorAll(':scope > div[class^="css-"]');
                augmentDivs.forEach(augDiv => {
                    let augmentName = 'N/A';
                    for (const className of augDiv.classList) {
                        const mappedName = ZED_API.utils.getAugmentNameByClass(className);
                        if (mappedName && mappedName !== 'Unknown Augment') {
                            augmentName = mappedName;
                            break;
                        }
                    }
                    currentAugments.push(ZED_API.utils.normalizeAugmentName(augmentName));
                });
            }

            while(currentAugments.length < 3) currentAugments.push('N/A');
            const finalAugments = currentAugments.slice(0,3);

            horses.push({ 
                id: horseId, 
                name: horseName, 
                gate: gate, 
                isUser: isUser, 
                currentAugments: finalAugments
            });
        });
        
        console.log(`Race Module: Extracted ${horses.length} horses. User: ${userHorseIds.size}.`);
        return { horses, userHorseIds: Array.from(userHorseIds) };
    }
    
    // --- Tab Management & Content Generation ---
    function switchTab(tabId, contentContainer, tabButtonContainer) {
        contentContainer.querySelectorAll('.race-helper-tab-content').forEach(pane => pane.classList.remove('active'));
        tabButtonContainer.querySelectorAll('.race-helper-tab-button').forEach(btn => btn.classList.remove('active'));
        const activePane = contentContainer.querySelector(`#${tabId}-content`);
        const activeButton = tabButtonContainer.querySelector(`[data-tab="${tabId}"]`);
        if (activePane) activePane.classList.add('active');
        if (activeButton) activeButton.classList.add('active');
        GM_setValue(TAB_PREF_KEY, tabId);
    }

    function generateSummaryTabContent(currentRaceHorses, processedData) {
        if (!processedData || !processedData.horseStats || !ZED_API) {
            return '<p><em>Core API or Processed data not available for summary.</em></p>';
        }
        let html = '<div class="race-summary-content">';
        html += '<h4>Race Horse Summaries</h4>';

        if (currentRaceHorses.length === 0) {
            return '<p><em>No horses found in the current race to summarize.</em></p>';
        }
        currentRaceHorses.sort((a,b) => (a.gate || 99) - (b.gate || 99));

        currentRaceHorses.forEach(horseInRace => {
            const stats = processedData.horseStats[horseInRace.id];
            html += `<div class="horse-card ${horseInRace.isUser ? 'user-horse' : ''}">
                        <h5>${horseInRace.gate || 'G?'} - ${horseInRace.name} ${horseInRace.isUser ? '⭐' : ''}</h5>`;
            if (stats) {
                html += `<ul class="horse-stats-list">
                            <li><strong>Bloodline:</strong> ${stats.bloodline}</li>
                            <li><strong>Career:</strong> ${stats.races} races, ${stats.wins} wins (${(stats.winRate * 100).toFixed(1)}%), ${stats.top3} top 3 (${(stats.top3Rate * 100).toFixed(1)}%)</li>
                            <li><strong>Avg Finish:</strong> ${stats.avgFinish.toFixed(2)}</li>
                            <li><strong>Avg Rating:</strong> ${ZED_API.utils.getStarRating(stats.avgRating)} (${stats.avgRating.toFixed(0)})</li>
                            <li><strong>Last 5 Finishes:</strong> ${stats.last5Finishes.join(', ') || 'N/A'}</li>
                         </ul>`;
                html += '<p class="augments-title"><strong>Equipped Augments:</strong></p><ul class="current-augments-list">';
                horseInRace.currentAugments.forEach(aug => {
                    const desc = ZED_API.utils.getAugmentDescription(aug);
                    html += `<li>${aug}${desc !== 'Unknown Augment' && aug !=='N/A' ? `: <small>${desc}</small>` : ''}</li>`;
                });
                html += '</ul>';
                html += '<p class="augments-title"><strong>Last 3 Augment Sets (Historical):</strong></p><ul class="historical-augments-list">';
                stats.last3AugmentSets.forEach(set => { html += `<li>${set}</li>`; });
                html += `</ul>`;
            } else {
                html += '<p><em>No historical data found for this horse.</em></p>';
                html += '<p class="augments-title"><strong>Equipped Augments:</strong></p><ul class="current-augments-list">';
                horseInRace.currentAugments.forEach(aug => {
                    const desc = ZED_API.utils.getAugmentDescription(aug);
                    html += `<li>${aug}${desc !== 'Unknown Augment' && aug !=='N/A' ? `: <small>${desc}</small>` : ''}</li>`;
                });
                html += '</ul>';
            }
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    function setupModuleUI() {
        console.log('Race Module: Setting up UI...');
        if (!ZED_API || !ZED_API.isReady) return;

        const raceState = getRaceState();
        if (!raceState) return;
        
        const currentRaceDetails = getCurrentRaceInfo(raceState);
        const processedData = ZED_API.processedData;

        const contentContainer = ZED_API.getTabContentContainer();
        const tabButtonContainer = ZED_API.getTabButtonContainer();
        if (!contentContainer || !tabButtonContainer) return;

        contentContainer.innerHTML = '';
        tabButtonContainer.innerHTML = '';

        const tabs = [
            { id: 'raceSummary', label: 'Summary', contentFn: () => generateSummaryTabContent(currentRaceDetails.horses, processedData) },
            { id: 'triggerLikelihood', label: 'Trigger Likelihood', contentFn: () => '<p><em>Trigger Likelihood content to be implemented.</em></p>' },
            { id: 'setSuggestor', label: 'Set Suggestor', contentFn: () => '<p><em>Set Suggestor content to be implemented.</em></p>' }
        ];
        const lastActiveTab = GM_getValue(TAB_PREF_KEY, tabs[0].id);

        tabs.forEach(tab => {
            const button = document.createElement('button');
            button.className = 'race-helper-tab-button';
            button.dataset.tab = tab.id;
            button.textContent = tab.label;
            button.addEventListener('click', () => switchTab(tab.id, contentContainer, tabButtonContainer));
            tabButtonContainer.appendChild(button);

            const pane = document.createElement('div');
            pane.id = `${tab.id}-content`;
            pane.className = 'race-helper-tab-content';
            pane.innerHTML = tab.contentFn();
            contentContainer.appendChild(pane);
        });
        
        switchTab(lastActiveTab, contentContainer, tabButtonContainer);
        console.log('Race Module: Tabbed UI populated.');
    }

    // --- Initialization Logic (onPageReady, observePageContent, initializeWhenCoreReady) ---
    function onPageReady() {
        if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
        setupModuleUI();
    }
    function observePageContent() {
        const targetNode = document.querySelector('div.css-1ayvxu3');
        if (targetNode && targetNode.querySelector('a.chakra-link.css-gu1x9h[href^="/horse/"]')) {
            onPageReady(); return;
        }
        pageObserver = new MutationObserver(() => {
            const targetNodeNow = document.querySelector('div.css-1ayvxu3');
            if (targetNodeNow && targetNodeNow.querySelector('a.chakra-link.css-gu1x9h[href^="/horse/"]')) {
                onPageReady();
            }
        });
        pageObserver.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
            if (pageObserver) {
                const targetNodeFallback = document.querySelector('div.css-1ayvxu3');
                if (targetNodeFallback && targetNodeFallback.querySelector('a.chakra-link.css-gu1x9h[href^="/horse/"]')) {
                    onPageReady();
                }
            }
        }, 3000); 
    }
    function initializeWhenCoreReady() {
        ZED_API = window.ZEDInsightsAPI;
        console.log('Race Module: Core API ready, initializing specifics.');
        try { GM_addStyle(GM_getResourceText("raceModuleCSS")); } catch (e) { console.warn('Race Module CSS not found or error loading.'); }
        observePageContent();
        document.addEventListener('ZEDInsightsDataRefreshed', () => {
            console.log("Race Module: Core data refreshed. Re-evaluating UI.");
            if (document.querySelector('div.css-1ayvxu3')) setupModuleUI();
            else console.log("Race Module: Race page elements no longer found after refresh.");
        });
    }
    if (window.ZEDInsightsAPI && window.ZEDInsightsAPI.isReady) initializeWhenCoreReady();
    else document.addEventListener('ZEDInsightsCoreReady', function onCoreReady() {
        document.removeEventListener('ZEDInsightsCoreReady', onCoreReady);
        initializeWhenCoreReady();
    });
})(); 