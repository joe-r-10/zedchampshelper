// ==UserScript==
// @name         ZED Insights - Core
// @namespace    zed-champions-insights
// @version      1.0.3
// @description  Core functionalities for ZED Champions insights scripts.
// @author       Your Name/Team
// @match        *://app.zedchampions.com/*
// @connect      raw.githubusercontent.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        GM_registerMenuCommand
// @resource     coreCSS core.css
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log('ZED Insights Core Script Loaded (v1.0.3)');

    const CSV_URL = 'https://raw.githubusercontent.com/myblood-tempest/zed-champions-race-data/refs/heads/main/race_results.csv';
    const SCRIPT_VERSION = '1.0.3';

    window.ZEDInsightsAPI = {
        isReady: false,
        rawRaceData: null,
        processedData: { // Initialize with a default structure
            horseStats: {},
            historicalSetData: {},
            allRacesById: {},
            // other aggregated data can go here
        },
        overlayElement: null,
        tabContainerElement: null,
        contentAreaElement: null,
        config: {
            cacheDurationMinutes: 30,
            get cacheDurationMs() { return this.config.cacheDurationMinutes * 60 * 1000; }
        },
        dataMaps: {
            AUGMENT_CLASS_TO_NAME_MAP: {
                'css-1166pzz': 'Void C100', 'css-1dx9val': 'Crimson C', 'css-1j6pz75': 'GX-Core C', 'css-544lsd': 'Darklight 100C', 'css-1mlwhd9': 'Midnight 100C',
                'css-k9ovie': 'GX-Core H', 'css-1bgdo0i': 'Midnight 100H', 'css-1e93zic': 'Darklight 100H', 'css-1msqddv': 'Void H100', 'css-1f94et9': 'Crimson H',
                'css-dtfl1i': 'Midnight 100R', 'css-ws1vl': 'Crimson R', 'css-kqx9sc': 'GX-Core R', 'css-1n98s80': 'Void R100', 'css-wywzem': 'Darklight 100R'
            },
            AUGMENT_DESCRIPTIONS: {
                'Void C100': "Passive speed boost.", 'Crimson C': "Boost when ahead of leader.", 'GX-Core C': "Boost when behind leader.", 'Darklight 100C': "Boost when near front early.", 'Midnight 100C': "Boost when behind pack early.",
                'GX-Core H': "Boost on final stretch.", 'Midnight 100H': "Boost when behind adjacent horse.", 'Darklight 100H': "Boost when ahead early.", 'Void H100': "Passive speed boost.", 'Crimson H': "Boost when near leader late.",
                'Midnight 100R': "Boost when behind pack late.", 'Crimson R': "Boost when ahead of adjacent horse.", 'GX-Core R': "Boost when passing.", 'Void R100': "Passive speed boost.", 'Darklight 100R': "Boost when near front mid-race.", 'N/A': "None"
            },
            // Potentially add STRATEGY_AUGMENTS, BLOODLINE_WEIGHTS if they are core data
             STRATEGY_AUGMENTS: { // From old script
                AGGRESSIVE_STARTER: ["Darklight 100C", "Darklight 100R"],
                BIG_FINISHER: ["Crimson C", "GX-Core H"],
                PASSIVE_SPEEDSTER: ["Void C100", "Void H100", "Void R100"],
                AUGMENT_MERCHANT: ["GX-Core C", "Midnight 100H", "Crimson R", "GX-Core R", "Midnight 100C", "Darklight 100H", "Midnight 100R"]
            },
        },
        utils: {
            getAugmentNameByClass(className) { return window.ZEDInsightsAPI.dataMaps.AUGMENT_CLASS_TO_NAME_MAP[className] || 'Unknown Augment'; },
            getAugmentDescription(augmentName) { return window.ZEDInsightsAPI.dataMaps.AUGMENT_DESCRIPTIONS[augmentName] || "Unknown Augment"; },
            getStarRating(rating) {
                const numericRating = parseFloat(rating);
                if (isNaN(numericRating)) return '-';
                if (numericRating >= 800) return '⭐️⭐️⭐️⭐️⭐️'; if (numericRating >= 600) return '⭐️⭐️⭐️⭐️';
                if (numericRating >= 400) return '⭐️⭐️⭐️'; if (numericRating >= 200) return '⭐️⭐️';
                if (numericRating >= 0)   return '⭐️'; return '-';
            },
            calculateStandardDeviation(dataArray) {
                if (!dataArray || dataArray.length === 0) return 0;
                const mean = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
                const variance = dataArray.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / dataArray.length;
                return Math.sqrt(variance);
            },
             // Helper to normalize augment names (e.g. from CSV columns like cpu_augment)
            normalizeAugmentName(augment) {
                if (!augment || typeof augment !== 'string') return 'N/A';
                return augment.trim(); // Basic normalization
            }
        },

        async init() {
            console.log('ZED Insights Core API Initializing...');
            this.loadCoreCSS();
            this.createOverlayShell();
            
            await this.loadRawData();
            await this.preprocessData(); // Now with more substance

            this.isReady = true;
            document.dispatchEvent(new CustomEvent('ZEDInsightsCoreReady', { detail: this }));
            console.log('ZED Insights Core API Ready');

            GM_registerMenuCommand('Clear ZED Insights Cache', () => {
                this.clearCache();
                alert('ZED Insights data cache cleared. Please reload the page.');
            }, 'C');
        },

        loadCoreCSS() {
            try {
                const cssText = GM_getResourceText("coreCSS");
                if (cssText) {
                    GM_addStyle(cssText);
                    console.log('Core CSS applied.');
                } else {
                    console.warn('Core CSS resource not found or empty.');
                }
            } catch (e) {
                console.error('Error loading core CSS:', e);
            }
        },

        createOverlayShell() {
            if (document.getElementById('zed-insights-overlay')) return; // Avoid duplicates

            this.overlayElement = document.createElement('div');
            this.overlayElement.id = 'zed-insights-overlay';
            this.overlayElement.className = 'race-helper-overlay'; // Use existing class from core.css

            const isInitiallyCollapsed = GM_getValue('overlayCollapsed', false);
            if (isInitiallyCollapsed) {
                this.overlayElement.classList.add('collapsed');
            }

            // Header with Buttons
            const header = document.createElement('div');
            header.className = 'race-helper-header';
            
            const headerButtons = document.createElement('div');
            headerButtons.className = 'race-helper-header-buttons';

            const refreshBtn = document.createElement('button');
            refreshBtn.id = 'zed-insights-refresh-btn';
            refreshBtn.className = 'race-helper-refresh-btn';
            refreshBtn.title = 'Refresh Data & Analysis';
            refreshBtn.textContent = 'Refresh';

            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'zed-insights-toggle-btn';
            toggleBtn.className = 'race-helper-toggle-btn';
            toggleBtn.title = 'Toggle Details';
            toggleBtn.textContent = isInitiallyCollapsed ? '▼' : '▲';

            headerButtons.appendChild(refreshBtn);
            headerButtons.appendChild(toggleBtn);
            header.appendChild(headerButtons);
            this.overlayElement.appendChild(header);

            // Tab Button Container (modules will add buttons here)
            this.tabContainerElement = document.createElement('div');
            this.tabContainerElement.id = 'zed-insights-tab-container';
            this.tabContainerElement.className = 'race-helper-tabs'; // Uses styles from core.css
            this.overlayElement.appendChild(this.tabContainerElement);

            // Main Content Area (modules will add their tab content panes here)
            this.contentAreaElement = document.createElement('div');
            this.contentAreaElement.id = 'zed-insights-main-content'; // Corresponds to #race-helper-main-content in CSS
            this.overlayElement.appendChild(this.contentAreaElement);
            
            document.body.appendChild(this.overlayElement);
            this.overlayElement.addEventListener('click', this.handleCoreOverlayClick.bind(this));
            console.log('ZED Insights Core: Overlay shell created.');
        },

        getTabButtonContainer() {
            return this.tabContainerElement;
        },

        getTabContentContainer() {
            return this.contentAreaElement;
        },

        toggleOverlayCollapse() {
            if (!this.overlayElement) return;
            const isCollapsed = this.overlayElement.classList.toggle('collapsed');
            GM_setValue('overlayCollapsed', isCollapsed);
            const toggleButton = this.overlayElement.querySelector('#zed-insights-toggle-btn');
            if (toggleButton) {
                toggleButton.textContent = isCollapsed ? '▼' : '▲';
            }
            console.log(`ZED Insights Core: Overlay ${isCollapsed ? 'collapsed' : 'expanded'}.`);
        },

        handleCoreOverlayClick(event) {
            const target = event.target;
            if (target.id === 'zed-insights-toggle-btn') {
                this.toggleOverlayCollapse();
            } else if (target.id === 'zed-insights-refresh-btn') {
                console.log('ZED Insights Core: Refresh button clicked.');
                // Generic refresh action: re-fetch data and notify modules
                // Modules are responsible for re-rendering their specific content if they listen for this or have their own refresh logic.
                target.disabled = true;
                target.textContent = '...';
                this.loadRawData().then(() => {
                    this.preprocessData().then(() => {
                         document.dispatchEvent(new CustomEvent('ZEDInsightsDataRefreshed', { detail: this })); // New event for modules
                         console.log('ZED Insights Core: Data refreshed and ZEDInsightsDataRefreshed event dispatched.');
                         target.disabled = false;
                         target.textContent = 'Refresh';
                    });
                }).catch(err => {
                    console.error("Error during refresh data: ", err);
                    target.disabled = false;
                    target.textContent = 'Refresh';
                });
            }
            // Tab switching logic will be handled by the module that creates the tabs,
            // as it owns the tab buttons and content panes.
        },

        async loadRawData() {
            const cacheKey = `zedRaceDataCache_v${SCRIPT_VERSION}`;
            const cacheTimestampKey = `zedRaceDataTimestamp_v${SCRIPT_VERSION}`;
            const now = Date.now();
            const cachedTimestamp = GM_getValue(cacheTimestampKey, 0);
            const cachedDataString = GM_getValue(cacheKey, null);

            if (cachedDataString && (now - cachedTimestamp < this.config.cacheDurationMs)) {
                console.log("ZED Insights Core: Using cached CSV data.");
                try {
                    const parsedData = Papa.parse(cachedDataString, {
                        header: true, skipEmptyLines: true, dynamicTyping: true
                    });
                    if (parsedData.errors.length > 0) {
                        console.warn("ZED Insights Core: CSV Parsing Errors (Cache):", parsedData.errors);
                    } else {
                        this.rawRaceData = parsedData.data;
                        console.log(`ZED Insights Core: Parsed ${this.rawRaceData.length} records from cache.`);
                        return;
                    }
                } catch (e) {
                    console.error("ZED Insights Core: Error parsing cached CSV data:", e);
                    this.clearCache();
                }
            }
            console.log("ZED Insights Core: Fetching fresh CSV data from", CSV_URL);
            try {
                const response = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET', url: CSV_URL, timeout: 30000,
                        onload: (res) => resolve(res), onerror: (err) => reject(err),
                        ontimeout: () => reject(new Error('Request timed out'))
                    });
                });
                if (response.status >= 200 && response.status < 300) {
                    const parsedData = Papa.parse(response.responseText, {
                        header: true, skipEmptyLines: true, dynamicTyping: true
                    });
                    if (parsedData.errors.length > 0) console.warn("ZED Insights Core: CSV Parsing Errors (Fetch):", parsedData.errors);
                    if (parsedData.data && parsedData.data.length > 0) {
                        this.rawRaceData = parsedData.data;
                        GM_setValue(cacheKey, response.responseText);
                        GM_setValue(cacheTimestampKey, Date.now());
                        console.log(`ZED Insights Core: Fetched and parsed ${this.rawRaceData.length} fresh records.`);
                    } else console.error("ZED Insights Core: Parsed fresh data is empty or invalid.");
                } else console.error("ZED Insights Core: Failed to fetch CSV, Status:", response.status, response.statusText);
            } catch (error) {
                console.error("ZED Insights Core: Error during GM_xmlhttpRequest or parsing fresh data:", error);
            }
            if (!this.rawRaceData) {
                 console.warn("ZED Insights Core: No race data available after attempting fetch.");
                 this.rawRaceData = []; 
            }
        },
        
        async preprocessData() {
            console.log("ZED Insights Core: Starting data preprocessing...");
            if (!this.rawRaceData || this.rawRaceData.length === 0) {
                console.warn("ZED Insights Core: No raw data to preprocess.");
                this.processedData = { horseStats: {}, historicalSetData: {}, allRacesById: {} }; // Reset
                return Promise.resolve();
            }

            const allRaces = {}; // Group by race_id for expected rank calculation
            const horseHistory = {}; // Group by horse_id
            const allHistoricalSets = {}; // For global augment set performance

            // First pass: group data and basic calcs
            this.rawRaceData.forEach(race => {
                if (!race.race_id || !race.horse_id) return; // Skip incomplete records

                // Group by race_id
                if (!allRaces[race.race_id]) {
                    allRaces[race.race_id] = { entries: [], totalOdds: 0 };
                }
                allRaces[race.race_id].entries.push(race);
                allRaces[race.race_id].totalOdds += parseFloat(race.odds) || 0; // Sum odds for expected rank later

                // Group by horse_id
                if (!horseHistory[race.horse_id]) {
                    horseHistory[race.horse_id] = [];
                }
                horseHistory[race.horse_id].push(race);
            });

            // Calculate expectedRank for each entry
            for (const raceId in allRaces) {
                const race = allRaces[raceId];
                if (race.totalOdds > 0) {
                    race.entries.forEach(entry => {
                        entry.expectedRank = (parseFloat(entry.odds) / race.totalOdds) * race.entries.length;
                        // The old script had a more complex expectedRank, this is simplified.
                        // The original used: odds / totalOddsInRace * numHorsesInRace; then sorted by this.
                        // For now, this is a proportional expected rank.
                    });
                } else {
                     race.entries.forEach(entry => entry.expectedRank = race.entries.length / 2); // Default if no odds
                }
            }
            
            this.processedData.allRacesById = allRaces; // Store for potential use by modules

            // Second pass: process individual horse histories
            const processedHorseStats = {};
            for (const horseId in horseHistory) {
                const history = horseHistory[horseId].sort((a, b) => new Date(b.race_date) - new Date(a.race_date)); // Most recent first
                
                const stats = {
                    id: horseId,
                    name: history[0]?.horse_name || 'Unknown Horse', // Assuming name is consistent
                    races: history.length,
                    wins: 0,
                    top3: 0,
                    avgFinish: 0,
                    winRate: 0,
                    top3Rate: 0,
                    avgRating: 0, // Assuming 'rating' column exists and is numeric
                    bloodline: history[0]?.bloodline || 'Unknown',
                    last5Finishes: [],
                    last3AugmentSets: [],
                    avgOddsLast3: 0,
                    finishTimes: [], // For std dev calc
                    avgExpectedRank: 0,
                    avgRankDifference: 0, // Actual finish - expectedRank
                    setPerformance: {}, // Performance with specific augment sets
                    // ... other stats from old script to be added
                };

                let totalFinishPos = 0;
                let totalRating = 0;
                let totalExpectedRank = 0;
                let totalRankDifference = 0;
                const recentAugmentsForOdds = [];

                history.forEach((race, index) => {
                    const finishPos = parseInt(race.finish_position, 10);
                    if (!isNaN(finishPos)) {
                        totalFinishPos += finishPos;
                        if (finishPos === 1) stats.wins++;
                        if (finishPos <= 3) stats.top3++;
                        if (stats.last5Finishes.length < 5) stats.last5Finishes.push(finishPos);
                        if (parseFloat(race.finish_time)) stats.finishTimes.push(parseFloat(race.finish_time));
                    }

                    if (parseFloat(race.rating)) totalRating += parseFloat(race.rating);
                    if (race.expectedRank) totalExpectedRank += race.expectedRank;
                    if (!isNaN(finishPos) && race.expectedRank) totalRankDifference += (finishPos - race.expectedRank);
                    
                    // Augment Sets
                    const set = [
                        this.utils.normalizeAugmentName(race.cpu_augment),
                        this.utils.normalizeAugmentName(race.hydraulic_augment),
                        this.utils.normalizeAugmentName(race.ram_augment)
                    ].sort().join(' | ');

                    if (index < 3) stats.last3AugmentSets.push(set);
                    if (index < 3 && parseFloat(race.odds)) recentAugmentsForOdds.push(parseFloat(race.odds));

                    // Track set performance for this horse
                    if (!stats.setPerformance[set]) {
                        stats.setPerformance[set] = { count: 0, wins: 0, totalFinish: 0 };
                    }
                    stats.setPerformance[set].count++;
                    if (finishPos === 1) stats.setPerformance[set].wins++;
                    stats.setPerformance[set].totalFinish += finishPos;
                    
                    // Track global set performance
                    if (!allHistoricalSets[set]) {
                        allHistoricalSets[set] = { count: 0, wins: 0, totalFinish: 0, entries: 0 };
                    }
                    allHistoricalSets[set].count++; // Number of times this exact set was seen
                    allHistoricalSets[set].entries++; // Number of horses that used this set
                    if (finishPos === 1) allHistoricalSets[set].wins++;
                    allHistoricalSets[set].totalFinish += finishPos;
                });

                if (stats.races > 0) {
                    stats.avgFinish = totalFinishPos / stats.races;
                    stats.winRate = stats.wins / stats.races;
                    stats.top3Rate = stats.top3 / stats.races;
                    stats.avgRating = totalRating / stats.races;
                    stats.avgExpectedRank = totalExpectedRank / stats.races;
                    stats.avgRankDifference = totalRankDifference / stats.races;
                }
                if (recentAugmentsForOdds.length > 0) {
                    stats.avgOddsLast3 = recentAugmentsForOdds.reduce((s, o) => s + o, 0) / recentAugmentsForOdds.length;
                }
                stats.finishTimeStdDev = this.utils.calculateStandardDeviation(stats.finishTimes.filter(ft => ft > 0));

                processedHorseStats[horseId] = stats;
            }
            this.processedData.horseStats = processedHorseStats;

            // Finalize global set data
            const finalHistoricalSetData = {};
            for (const set in allHistoricalSets) {
                const data = allHistoricalSets[set];
                finalHistoricalSetData[set] = {
                    setKey: set,
                    count: data.count,
                    entries: data.entries,
                    winRate: data.entries > 0 ? data.wins / data.entries : 0,
                    avgFinish: data.entries > 0 ? data.totalFinish / data.entries : 0,
                };
            }
            this.processedData.historicalSetData = finalHistoricalSetData;

            console.log(`ZED Insights Core: Finished preprocessing. Processed ${Object.keys(this.processedData.horseStats).length} horses and ${Object.keys(this.processedData.historicalSetData).length} unique augment sets.`);
            return Promise.resolve();
        },

        clearCache() {
            GM_setValue(`zedRaceDataCache_v${SCRIPT_VERSION}`, null);
            GM_setValue(`zedRaceDataTimestamp_v${SCRIPT_VERSION}`, null);
            console.log('ZED Insights Core: Cache cleared.');
        }
    };

    try {
        window.ZEDInsightsAPI.init();
    } catch (error) {
        console.error('Failed to initialize ZED Insights Core API:', error);
    }

})(); 