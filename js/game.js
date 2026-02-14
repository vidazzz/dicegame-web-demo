// 难度常量
const DIFFICULTY = {
    EASY: 'easy',
    HARD: 'hard'
};

// 游戏阶段
const GAME_PHASE = {
    SETUP: 'setup',           // 准备阶段
    COLLECT: 'collect',       // 情报收集
    PROCESS: 'process',       // 情报处理
    EVENT: 'event',           // 交涉进行
    RESULT: 'result'          // 结算
};

// 游戏配置
const GAME_CONFIG = {
    TOPIC_COUNT: 3,           // 话题数量
    ACTION_POINTS: 10,        // 初始行动点

    // 简单难度情报配置
    EASY: {
        BAD_INTEL_COUNT: 1,   // 每个话题不利情报数
        GOOD_300_COUNT: 2,    // 每个话题300分有利情报数
        GOOD_100_COUNT: 1     // 每个话题100分有利情报数
    },

    // 困难难度情报配置
    HARD: {
        BAD_INTEL_COUNT: 3,   // 每个话题不利情报数
        GOOD_300_COUNT: 2,    // 每个话题300分有利情报数
        GOOD_100_COUNT: 1     // 每个话题100分有利情报数
    }
};

// 主游戏类
class Game {
    constructor() {
        this.actionPoints = GAME_CONFIG.ACTION_POINTS;
        this.maxActionPoints = GAME_CONFIG.ACTION_POINTS;
        this.gamePhase = GAME_PHASE.SETUP;
        this.currentTopic = 1;

        this.npcs = [];
        this.allIntels = [];
        this.collectedIntels = new Set();
        this.processedIntels = new Set();  // 交涉阶段使用：标记已应对的情报
        this.processedIntelsInProcessStage = new Set();  // 处理阶段使用：标记已处理的情报（不影响交涉阶段）
        this.knownKnowers = new Map(); // 玩家已知的情报知情人
        this.interactedNPCs = new Set(); // 已交互过的 NPC
        this.pendingShares = new Map(); // 等待确认的告知列表: intelId -> [npcNames]
        this.selectedNPCsForEvent = new Set(); // EVENT阶段选中的NPC
        this.selectedGoodIntelId = null; // 有利情报阶段当前选中的情报ID

        this.intelGenerator = new IntelGenerator();

        // Fever 状态
        this.feverActive = false;
        this.feverStreak = 0;
        this.feverScores = []; // Fever 期间的得分
        this.currentFeverMultiplier = 1.0;

        // 话题结果
        this.topicResults = [];
        this.totalScore = 0;

        // 交涉阶段 - 卡牌游戏模式状态
        this.eventBadIntelIndex = 0;  // 当前不利情报索引
        this.eventGoodIntelIndex = 0; // 当前有利情报索引
        this.eventPhase = 'bad';      // 'bad' | 'good' | 'complete'
        this.bonusIntelId = null;     // 当前需要加成判定的不利情报ID
        this.originalBadIntelCount = 0; // 记录原始不利情报数量（用于阶段切换判断）
        this.originalGoodIntelCount = 0; // 记录原始有利情报数量（用于阶段切换判断）

        // 初始化
        this.initNPCs();
    }

    // 初始化 NPC
    initNPCs() {
        this.npcs = NPC_POOL.map(npc => createNPC(npc.name, npc.role));
    }

    // 开始游戏
    startGame(difficulty = DIFFICULTY.EASY) {
        this.difficulty = difficulty;
        this.gamePhase = GAME_PHASE.COLLECT;

        // 生成事件情报
        this.generateEventIntels();

        // 设置初始情报
        this.setupInitialIntels();

        this.log('游戏开始！', 'info');
        this.log(`难度: ${difficulty === DIFFICULTY.EASY ? '简单' : '困难'}`, 'info');
        this.render();
    }

    // 生成事件所有话题的情报
    generateEventIntels() {
        // 选择参与事件的 NPC
        const eventNPCs = this.getEventNPCs();

        // 为每个话题生成情报
        for (let topic = 1; topic <= GAME_CONFIG.TOPIC_COUNT; topic++) {
            const topicIntels = this.intelGenerator.generateTopicIntels(
                topic,
                this.difficulty,
                eventNPCs
            );
            this.allIntels.push(...topicIntels);
        }

        // 为所有NPC分配情报，确保每个NPC至少有一个情报
        this.intelGenerator.distributeIntelsToNPCs(this.allIntels, this.npcs);

        // 记录 NPC 知道的情报
        eventNPCs.forEach(npc => {
            this.allIntels.forEach(intel => {
                if (intel.knowers.includes(npc.name)) {
                    npc.addIntel(intel);
                }
            });
        });
    }

    // 获取参与事件的 NPC
    getEventNPCs() {
        // 随机选择 3 个 NPC
        const shuffled = [...this.npcs].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 3);
    }

    // 设置初始情报
    setupInitialIntels() {
        const totalIntels = this.allIntels.length;
        const percent = 0.3 + Math.random() * 0.4; // 30%-70%

        const initialCount = Math.floor(totalIntels * percent);
        const initialIntels = this.allIntels.slice(0, initialCount);

        initialIntels.forEach(Intel => {
            this.collectedIntels.add(Intel.id);
        });

        // 计算初始情报占总情报的比例
        const actualPercent = (initialCount / totalIntels) * 100;
        let percentDesc;
        if (actualPercent < 40) {
            percentDesc = '小部分';
        } else if (actualPercent <= 60) {
            percentDesc = '一半';
        } else {
            percentDesc = '大部份';
        }

        this.log(`初始情报: ${initialCount}/${totalIntels} (${percentDesc})`, 'info');

        // 检查每个 NPC 是否已经把所有情报都给出了
        this.npcs.forEach(npc => {
            const hasNewIntel = npc.knownIntels.some(IntelId => !this.collectedIntels.has(IntelId));
            if (!hasNewIntel) {
                this.interactedNPCs.add(npc.name);
            }
        });
    }

    // 从 NPC 收集情报
    collectFromNPC(npcName) {
        if (this.actionPoints <= 0) {
            this.log('行动点不足！', 'fail');
            return;
        }

        const npc = this.npcs.find(n => n.name === npcName);
        if (!npc) return;

        // 消耗行动点
        this.actionPoints--;

        // 计算成功率
        const successChance = npc.intelRate / 100;

        if (Math.random() < successChance) {
            // 收集成功
            const newIntels = [];
            npc.knownIntels.forEach(IntelId => {
                if (!this.collectedIntels.has(IntelId)) {
                    this.collectedIntels.add(IntelId);
                    const intel = this.allIntels.find(i => i.id === IntelId);
                    if (intel) {
                        newIntels.push(intel);
                    }
                }
            });

            if (newIntels.length > 0) {
                // 成功获得情报，标记为已交互
                this.interactedNPCs.add(npcName);
                this.log(`从 ${npcName} 获得情报: ${newIntels.map(i => i.name).join(', ')}`, 'success');
            } else {
                this.log(`从 ${npcName} 没有新情报`, 'info');
            }
        } else {
            // 收集失败
            npc.intelRate = Math.min(100, npc.intelRate + 10);
            this.log(`从 ${npcName} 收集失败！成功率提升至 ${npc.intelRate}%`, 'fail');
        }

        this.render();
    }

    // 进入情报处理阶段
    startProcessStage() {
        this.gamePhase = GAME_PHASE.PROCESS;
        this.log('========== 情报处理阶段 ==========', 'info');
        this.render();
    }

    // 处理情报
    // 处理情报 - 投骰子成功后增加骰子
    processIntel(IntelId) {
        if (this.actionPoints <= 0) {
            this.log('行动点不足！', 'fail');
            return;
        }

        const intel = this.allIntels.find(i => i.id === IntelId);
        if (!intel) return;

        // 消耗行动点
        this.actionPoints--;

        // 投骰子
        const diceNumber = this.rollDice();
        const success = intel.numbers.includes(diceNumber);

        if (success) {
            const newNum = intel.addRandomNumber();
            this.processedIntelsInProcessStage.add(IntelId);
            this.log(`处理 "${intel.name}" 成功！投出 ${diceNumber}，增加骰子 ${newNum}`, 'success');
        } else {
            this.log(`处理 "${intel.name}" 失败！投出 ${diceNumber}，与情报骰子不符`, 'fail');
        }

        this.render();
    }

    // 处理情报处理阶段 NPC 勾选变化（即时扣减行动点）
    handleShareCheckboxChange(intelId, npcName, isChecked) {
        if (isChecked) {
            // 勾选：检查行动点
            if (this.actionPoints <= 0) {
                // 行动点不足，取消勾选
                const checkbox = document.querySelector(`input[name="share-${intelId}"][value="${npcName}"]`);
                if (checkbox) checkbox.checked = false;
                this.log('行动点不足！', 'fail');
                return false;
            }
            // 扣除1点行动点
            this.actionPoints--;
            // 记录到 pendingShares
            if (!this.pendingShares.has(intelId)) {
                this.pendingShares.set(intelId, []);
            }
            this.pendingShares.get(intelId).push(npcName);
            this.log(`勾选 ${npcName} 告知情报告知（已扣除1行动点）`, 'info');
        } else {
            // 取消勾选：返还行动点
            this.actionPoints++;
            // 从 pendingShares 中移除
            if (this.pendingShares.has(intelId)) {
                const npcs = this.pendingShares.get(intelId);
                const index = npcs.indexOf(npcName);
                if (index > -1) {
                    npcs.splice(index, 1);
                }
            }
            this.log(`取消勾选 ${npcName}（已返还1行动点）`, 'info');
        }
        this.renderStatus();
        return true;
    }

    // EVENT阶段 NPC 勾选变化处理
    handleEventNPCSelectionChange(npcName, isChecked) {
        if (isChecked) {
            this.selectedNPCsForEvent.add(npcName);
        } else {
            this.selectedNPCsForEvent.delete(npcName);
        }
    }

    // 告知NPC情报（支持多人）
    shareIntelToNPC(IntelId) {
        const intel = this.allIntels.find(i => i.id === IntelId);
        if (!intel) return;

        // 获取选中的NPC（复选框）
        const checkboxes = document.querySelectorAll(`input[name="share-${intel.id}"]:checked`);
        const selectedNpcs = Array.from(checkboxes).map(cb => cb.value);

        if (selectedNpcs.length === 0) {
            this.log('请选择要告知的NPC', 'fail');
            return;
        }

        const cost = selectedNpcs.length;
        if (this.actionPoints < cost) {
            this.log(`行动点不足！需要 ${cost} 点`, 'fail');
            return;
        }

        // 消耗行动点
        this.actionPoints -= cost;

        // 告知每个选中的NPC
        const newKnowers = [];
        selectedNpcs.forEach(npcName => {
            const npc = this.npcs.find(n => n.name === npcName);
            if (!npc) return;

            // 检查是否已经是知情人
            if (!intel.knowers.includes(npcName)) {
                intel.addKnower(npcName);
                npc.addIntel(intel);
                newKnowers.push(npcName);
            }
        });

        if (newKnowers.length > 0) {
            this.log(`已将 "${intel.name}" 告知 ${newKnowers.join(', ')}（消耗 ${cost} 行动点）`, 'success');
        } else {
            this.log('所选NPC都已知晓此情报', 'info');
        }

        this.render();
    }

    // 进入话题执行阶段
    startTopic() {
        // 获取当前话题的所有情报
        const currentTopicIntels = this.getCurrentTopicIntels();
        const shareResults = [];

        // 使用 pendingShares 中记录的勾选来执行告知（行动点已在勾选时扣除）
        currentTopicIntels.forEach(intel => {
            const pendingNpcs = this.pendingShares.get(intel.id) || [];
            pendingNpcs.forEach(npcName => {
                if (!intel.knowers.includes(npcName)) {
                    const npc = this.npcs.find(n => n.name === npcName);
                    if (npc) {
                        intel.addKnower(npcName);
                        npc.addIntel(intel);
                        shareResults.push({ npc: npcName, intel: intel.name });
                    }
                }
            });
        });

        // 输出告知结果
        if (shareResults.length > 0) {
            const shareByNpc = {};
            shareResults.forEach(({ npc, intel }) => {
                if (!shareByNpc[npc]) shareByNpc[npc] = [];
                shareByNpc[npc].push(intel);
            });

            for (const [npc, intels] of Object.entries(shareByNpc)) {
                this.log(`已将 ${intels.length} 个情报告知 ${npc}`, 'success');
            }
        }

        // 清空 pendingShares
        this.pendingShares.clear();

        this.gamePhase = GAME_PHASE.EVENT;

        // 初始化卡牌游戏状态
        this.eventBadIntelIndex = 0;
        this.eventGoodIntelIndex = 0;
        this.eventPhase = 'bad';
        this.bonusIntelId = null;

        // 重置当前话题情报的 isGood 状态（因为情报对象在生成时被共享）
        currentTopicIntels.forEach(intel => {
            // 查找这个情报的原始状态（通过判断话题中不利情报的数量）
            // 不利情报一定是 !isGood，有利情报一定是 isGood
            const badIntels = this.allIntels.filter(i => i.topic === intel.topic && !i.isGood);
            if (badIntels.some(b => b.id === intel.id)) {
                intel.isGood = false;
            } else {
                intel.isGood = true;
            }
        });

        // 记录原始不利情报数量（用于阶段切换判断，不依赖动态变化的 isGood）
        const badIntels = currentTopicIntels.filter(i => !i.isGood);
        this.originalBadIntelCount = badIntels.length;

        // 记录原始有利情报数量
        const goodIntels = currentTopicIntels.filter(i => i.isGood);
        this.originalGoodIntelCount = goodIntels.length;

        // 检查是否有不利情报，如果没有直接进入有利情报阶段
        if (this.originalBadIntelCount === 0) {
            this.eventPhase = 'good';
        }

        // 每个 NPC 投骰子获得骰子
        this.npcs.forEach(npc => {
            const oldNum = npc.number;
            npc.refreshNumber();
            this.log(`${npc.name} 投出 ${npc.number}（原来是 ${oldNum}）`, 'info');
        });

        this.log('========== 交涉进行阶段 ==========', 'info');
        this.log(`当前话题: 第 ${this.currentTopic} 话题`, 'info');
        this.render();
    }

    // 获取当前应显示的情报卡片
    getCurrentEventIntel() {
        // 如果处于加成模式，直接返回当前要加成判定的情报
        // 不走正常阶段逻辑，避免影响索引计算
        if (this.bonusIntelId !== null) {
            const bonusIntel = this.allIntels.find(i => i.id === this.bonusIntelId);
            if (bonusIntel) {
                return {
                    intel: bonusIntel,
                    phase: 'bad',  // 保持 bad 阶段
                    index: this.eventBadIntelIndex,
                    total: this.originalBadIntelCount,
                    type: 'bonus'
                };
            }
        }

        const currentIntels = this.getCurrentTopicIntels();
        // 过滤出未处理的情报
        const unprocessed = currentIntels.filter(i => !this.processedIntels.has(i.id));
        // 从未处理的情报中分别获取不利和有利情报
        const badIntels = unprocessed.filter(i => !i.isGood);
        const goodIntels = unprocessed.filter(i => i.isGood);

        // 调试日志
        console.log('=== getCurrentEventIntel ===');
        console.log('bonusIntelId:', this.bonusIntelId);
        console.log('unprocessed.length:', unprocessed.length);
        console.log('badIntels.length:', badIntels.length);
        console.log('goodIntels.length:', goodIntels.length);
        console.log('processedIntels:', Array.from(this.processedIntels));

        // 1. 如果处于加成模式，直接返回当前要加成判定的情报
        if (this.bonusIntelId !== null) {
            const bonusIntel = this.allIntels.find(i => i.id === this.bonusIntelId);
            if (bonusIntel) {
                return {
                    intel: bonusIntel,
                    phase: 'bad',
                    index: this.eventBadIntelIndex,
                    total: this.originalBadIntelCount,
                    type: 'bonus'
                };
            }
        }

        // 2. 如果没有未处理的情报，话题结束
        if (unprocessed.length <= 0) {
            return { intel: null, phase: 'complete', index: 0, total: 0, type: 'none' };
        }

        // 3. 按顺序处理：先不利情报，再有利情报
        if (badIntels.length > 0) {
            return {
                intel: badIntels[0],
                phase: 'bad',
                index: this.eventBadIntelIndex,
                total: badIntels.length,
                type: 'resolve'
            };
        } else if (goodIntels.length > 0) {
            return {
                intel: goodIntels[0],
                phase: 'good',
                index: this.eventGoodIntelIndex,
                total: goodIntels.length,
                type: 'play'
            };
        }

        // 兜底：结束
        return { intel: null, phase: 'complete', index: 0, total: 0, type: 'none' };
    }

    // 获取当前话题的情报
    getCurrentTopicIntels() {
        return this.allIntels.filter(i => i.topic === this.currentTopic);
    }

    // 获取当前话题未处理的不利情报
    getCurrentTopicBadIntels() {
        return this.getCurrentTopicIntels().filter(i => !i.isGood);
    }

    // 获取当前话题未处理的有利情报
    getCurrentTopicGoodIntels() {
        return this.getCurrentTopicIntels().filter(i => i.isGood);
    }

    // 投骰子
    rollDice() {
        return Math.floor(Math.random() * 6) + 1;
    }

    // 解决不利情报
    // selectedNpcs: 选中的 NPC 名称数组（UI 已预先判定成功/失败）
    resolveBadIntel(IntelId, selectedNpcs = []) {
        const intel = this.allIntels.find(i => i.id === IntelId);
        if (!intel) return { success: false };

        // 投骰子
        const playerDice = this.rollDice();
        const diceResults = [playerDice];

        // 显示玩家投骰子结果
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff'];
        const diceDisplay = `<span style="color: ${colors[playerDice - 1]}; font-weight: bold;">${playerDice}</span>`;
        this.log(`<span style="color: #fff;">玩家投出骰子:</span> ${diceDisplay}`, 'info');

        // 获取已勾选的 NPC 骰子（UI 预判定成功才能勾选）
        selectedNpcs.forEach(npcName => {
            const npc = this.npcs.find(n => n.name === npcName);
            if (npc && npc.number !== null) {
                diceResults.push(npc.number);
                const npcDiceDisplay = `<span style="color: ${colors[npc.number - 1]}; font-weight: bold;">${npc.number}</span>`;
                this.log(`加成投骰: ${npc.name} ${npcDiceDisplay}`, 'info');
                npc.refreshNumber();
            }
        });

        // 检查是否有骰子匹配情报骰子
        const matchingCount = diceResults.filter(d => intel.numbers.includes(d)).length;
        const success = matchingCount > 0;

        if (success) {
            // 解决成功 - 转为有利情报
            intel.isGood = true;
            // 注意：暂时不加入 processedIntels，等加成阶段结束后再加入
            // 这样在加成阶段和有利情报阶段都能正确计算数量

            // 记录解决成功的骰子
            const successDice = diceResults.filter(d => intel.numbers.includes(d));

            this.log(`解决 "${intel.name}" 成功！匹配骰子: ${successDice.join(', ')}，情报骰子: ${intel.numbers.join(', ')}，进入加成判定...`, 'success');

            // 返回需要加成阶段
            return {
                success: true,
                intel: intel,
                matchedDice: successDice,
                needBonus: true
            };
        } else {
            // 解决失败
            this.exitFever();

            // 扣除分数
            const deductedScore = Math.min(100, intel.score);
            intel.score = Math.max(0, intel.score - deductedScore);
            this.log(`解决 "${intel.name}" 失败！情报骰子: ${intel.numbers.join(', ')}，扣除 ${deductedScore} 分`, 'fail');

            return { success: false, score: -deductedScore, dice: playerDice };
        }
    }

    // 加成判定（解决不利情报成功后调用）
    // selectedNpcs: 选中的 NPC 名称数组（可以重新选择）
    applyBonus(IntelId, selectedNpcs = []) {
        const intel = this.allIntels.find(i => i.id === IntelId);
        if (!intel) return { success: false, needBonus: false };

        // 投骰子
        const playerDice = this.rollDice();
        const diceResults = [playerDice];

        // 显示玩家投骰子结果
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff'];
        const diceDisplay = `<span style="color: ${colors[playerDice - 1]}; font-weight: bold;">${playerDice}</span>`;
        this.log(`<span style="color: #fff;">玩家投出骰子:</span> ${diceDisplay}`, 'info');

        // 获取已勾选的 NPC 骰子（UI 预判定成功才能勾选）
        selectedNpcs.forEach(npcName => {
            const npc = this.npcs.find(n => n.name === npcName);
            if (npc && npc.number !== null) {
                diceResults.push(npc.number);
                const npcDiceDisplay = `<span style="color: ${colors[npc.number - 1]}; font-weight: bold;">${npc.number}</span>`;
                this.log(`加成投骰: ${npc.name} ${npcDiceDisplay}`, 'info');
                npc.refreshNumber();
            }
        });

        // 计算匹配骰子的数量
        const matchingCount = diceResults.filter(d => intel.numbers.includes(d)).length;

        // 加成失败
        if (matchingCount === 0) {
            this.exitFever();
            this.log(`加成失败！情报骰子: ${intel.numbers.join(', ')}`, 'fail');

            // 加成都结束，标记为已处理
            this.processedIntels.add(IntelId);
            this.eventBadIntelIndex++;
            this.bonusIntelId = null;

            if (this.eventBadIntelIndex >= this.originalBadIntelCount) {
                this.eventPhase = 'good';
            }

            this.render();
            return { success: false, needBonus: false };
        }

        // 计算倍数
        let multiplier = 1;
        if (matchingCount === 2) multiplier = 2;
        else if (matchingCount === 3) multiplier = 4;
        else if (matchingCount >= 4) multiplier = 8;

        // 进入 Fever 状态
        this.enterFever();

        // 计算得分
        const baseScore = intel.score;
        const finalScore = baseScore * multiplier * this.currentFeverMultiplier;
        this.feverScores.push(finalScore);

        this.log(`加成成功！匹配 ${matchingCount} 个（${diceResults.join(', ')}）情报骰子: ${intel.numbers.join(', ')} ×${multiplier} = ${finalScore}`, 'success');

        return { success: true, score: finalScore, multiplier: multiplier, needBonus: false };
    }

    // 打出有利情报
    // selectedNpcs: 选中的 NPC 名称数组
    playGoodIntel(IntelId, selectedNpcs = []) {
        const intel = this.allIntels.find(i => i.id === IntelId);
        if (!intel) return { success: false };

        // 投骰子
        const playerDice = this.rollDice();
        const diceResults = [playerDice];

        // 显示玩家投骰子结果
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff'];
        const diceDisplay = `<span style="color: ${colors[playerDice - 1]}; font-weight: bold;">${playerDice}</span>`;
        this.log(`<span style="color: #fff;">玩家投出骰子:</span> ${diceDisplay}`, 'info');

        // 获取已勾选的 NPC 骰子（UI 预判定成功才能勾选）
        selectedNpcs.forEach(npcName => {
            const npc = this.npcs.find(n => n.name === npcName);
            if (npc && npc.number !== null) {
                diceResults.push(npc.number);
                const npcDiceDisplay = `<span style="color: ${colors[npc.number - 1]}; font-weight: bold;">${npc.number}</span>`;
                this.log(`加成投骰: ${npc.name} ${npcDiceDisplay}`, 'info');
                npc.refreshNumber();
            }
        });

        // 计算匹配骰子的数量
        const matchingCount = diceResults.filter(d => intel.numbers.includes(d)).length;
        const success = matchingCount > 0;

        if (success) {
            // 计算倍数
            let multiplier = 1;
            if (matchingCount === 2) multiplier = 2;
            else if (matchingCount === 3) multiplier = 4;
            else if (matchingCount >= 4) multiplier = 8;

            // 进入 Fever
            this.enterFever();

            // 计算得分
            const baseScore = intel.score;
            const finalScore = baseScore * multiplier * this.currentFeverMultiplier;
            this.feverScores.push(finalScore);

            this.processedIntels.add(IntelId);

            this.log(`有利情报 "${intel.name}" 加成成功！匹配 ${matchingCount} 个（${diceResults.join(', ')}）情报骰子: ${intel.numbers.join(', ')} ×${multiplier} = ${finalScore}`, 'success');

            return { success: true, score: finalScore, multiplier: multiplier };
        } else {
            // 失败 - 退出 Fever
            this.exitFever();
            this.log(`有利情报 "${intel.name}" 加成失败！情报骰子: ${intel.numbers.join(', ')}`, 'fail');

            // 失败也要标记为已处理
            this.processedIntels.add(IntelId);

            return { success: false };
        }
    }

    // 进入 Fever 状态
    enterFever() {
        if (!this.feverActive) {
            this.feverActive = true;
            this.feverStreak = 0;
            this.feverScores = [];
            this.currentFeverMultiplier = 1.0;
        }
        this.feverStreak++;
        this.currentFeverMultiplier = 1.0 + (this.feverStreak - 1) * 0.1;
    }

    // 获取当前显示分数
    getDisplayScore() {
        const feverBase = this.feverScores.reduce((a, b) => a + b, 0);
        const feverTotal = feverBase * this.currentFeverMultiplier;
        return {
            settled: this.totalScore,
            feverBase: feverBase,
            feverMultiplier: this.currentFeverMultiplier,
            feverTotal: feverTotal,
            display: Math.floor(this.totalScore + feverTotal)
        };
    }

    // 退出 Fever 状态
    exitFever() {
        if (this.feverActive && this.feverScores.length > 0) {
            // 结算 Fever 期间的得分
            const feverTotal = this.feverScores.reduce((a, b) => a + b, 0);
            const bonus = feverTotal * (this.currentFeverMultiplier - 1);
            this.totalScore += feverTotal;

            this.log(`Fever 结算: ${feverTotal} ×${this.currentFeverMultiplier.toFixed(1)} = ${feverTotal} (+${bonus.toFixed(0)} 加成)`, 'info');
        }

        this.feverActive = false;
        this.feverStreak = 0;
        this.feverScores = [];
        this.currentFeverMultiplier = 1.0;
    }

    // 跳过一个有利情报
    skipGoodIntel(IntelId) {
        this.processedIntels.add(IntelId);
        const intel = this.allIntels.find(i => i.id === IntelId);
        this.log(`跳过有利情报 "${intel.name}"`, 'info');
        this.render();
    }

    // 进入下一话题
    nextTopic() {
        // 结算当前话题的 Fever
        this.exitFever();

        // 清理待告知的 NPC 勾选状态（返还行动点）
        this.pendingShares.clear();

        // 清理 EVENT 阶段选中的 NPC
        this.selectedNPCsForEvent.clear();

        // 清理选中的有利情报
        this.selectedGoodIntelId = null;

        // 检查是否还有未打出的情报
        const currentIntels = this.getCurrentTopicIntels();
        const unplayed = currentIntels.filter(i => !this.processedIntels.has(i.id));

        if (unplayed.length > 0) {
            this.log(`还有 ${unplayed.length} 个情报未打出！`, 'fail');
            return;
        }

        if (this.currentTopic >= GAME_CONFIG.TOPIC_COUNT) {
            // 先结算剩余的Fever分数
            this.exitFever();
            // 进入结算阶段
            this.gamePhase = GAME_PHASE.RESULT;
            this.calculateResult();
        } else {
            // 进入下一话题
            this.currentTopic++;
            // 重置卡牌游戏状态
            this.eventBadIntelIndex = 0;
            this.eventGoodIntelIndex = 0;
            this.eventPhase = 'bad';
            this.bonusIntelId = null;

            // 重置当前话题情报的 isGood 状态
            const nextTopicIntels = this.getCurrentTopicIntels();
            nextTopicIntels.forEach(intel => {
                const badIntels = this.allIntels.filter(i => i.topic === intel.topic && !i.isGood);
                if (badIntels.some(b => b.id === intel.id)) {
                    intel.isGood = false;
                } else {
                    intel.isGood = true;
                }
            });

            // 记录下一话题的原始不利情报数量
            const nextTopicBadIntels = nextTopicIntels.filter(i => !i.isGood);
            this.originalBadIntelCount = nextTopicBadIntels.length;

            // 记录下一话题的原始有利情报数量
            const nextTopicGoodIntels = nextTopicIntels.filter(i => i.isGood);
            this.originalGoodIntelCount = nextTopicGoodIntels.length;

            this.log(`========== 第 ${this.currentTopic} 话题开始 ==========`, 'info');
        }

        this.render();
    }

    // 计算结果
    calculateResult() {
        // 统计所有已处理情报的分数
        let baseScore = 0;
        this.allIntels.forEach(intel => {
            if (this.processedIntels.has(intel.id)) {
                baseScore += intel.score;
            }
        });

        // 第一档: 基础分 × 1.5
        const tier1 = baseScore * 1.5;
        // 第二档: 基础分 × 4
        const tier2 = baseScore * 4;

        this.finalResult = {
            baseScore,
            tier1,
            tier2,
            totalScore: this.totalScore,
            rating: baseScore >= tier2 ? 'perfect' : (baseScore >= tier1 ? 'success' : 'fail')
        };

        this.log(`结算: 基础分 ${baseScore}`, 'info');
        this.log(`第一档: ${tier1.toFixed(0)}, 第二档: ${tier2.toFixed(0)}`, 'info');
    }

    // 重新开始
    restart() {
        this.actionPoints = GAME_CONFIG.ACTION_POINTS;
        this.maxActionPoints = GAME_CONFIG.ACTION_POINTS;
        this.gamePhase = GAME_PHASE.SETUP;
        this.currentTopic = 1;
        this.allIntels = [];
        this.collectedIntels = new Set();
        this.processedIntels = new Set();
        this.knownKnowers = new Map();
        this.interactedNPCs = new Set();
        this.feverActive = false;
        this.feverStreak = 0;
        this.feverScores = [];
        this.pendingShares.clear();
        this.selectedNPCsForEvent.clear();
        this.selectedGoodIntelId = null;
        this.totalScore = 0;
        this.phaseResults = [];
        // 重置卡牌游戏状态
        this.eventBadIntelIndex = 0;
        this.eventGoodIntelIndex = 0;
        this.eventPhase = 'bad';
        this.bonusIntelId = null;
        this.originalBadIntelCount = 0;
        this.originalGoodIntelCount = 0;
        this.initNPCs();
        this.render();
    }

    // 日志
    log(message, type = 'info') {
        const logContent = document.getElementById('log-content');
        if (logContent) {
            const entry = document.createElement('div');
            entry.className = `log-entry ${type}`;
            const diceMessage = this.convertDiceInMessage(message);
            entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${diceMessage}`;
            logContent.insertBefore(entry, logContent.firstChild);
        }
        console.log(`[${type}] ${message}`);
    }

    // 渲染单个骰子图案
    renderDice(number, size = 20) {
        const diceChars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff'];
        return `<span class="dice-char" style="font-size: ${size}px; color: ${colors[number - 1]};">${diceChars[number - 1]}</span>`;
    }

    // 渲染一组骰子为骰子
    renderDiceNumbers(numbers, size = 40) {
        return numbers.map(n => this.renderDice(n, size)).join('');
    }

    // 将消息中的骰子转换为数字（保留颜色）
    convertDiceInMessage(message) {
        const diceNums = ['1', '2', '3', '4', '5', '6'];
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#ff9ff3', '#54a0ff'];
        // 只在"情报骰子:"和"投出"后面转换1-6的数字
        return message.replace(/(情报骰子:|投出)\s*([1-6](?:\s*,\s*[1-6])*)/g, (match, prefix) => {
            const numbers = match.replace(prefix, '').trim().split(/\s*,\s*/);
            const diceHtml = numbers.map(n => {
                const num = parseInt(n) - 1;
                return `<span class="dice-char" style="color: ${colors[num]}; font-weight: bold;">${diceNums[num]}</span>`;
            }).join('');
            return `${prefix}${diceHtml}`;
        });
    }

    // 渲染
    render() {
        this.renderStatus();
        this.renderNPCs();

        const main = document.getElementById('game-main');
        main.innerHTML = '';

        switch (this.gamePhase) {
            case GAME_PHASE.SETUP:
                this.renderSetup(main);
                break;
            case GAME_PHASE.COLLECT:
                this.renderCollect(main);
                break;
            case GAME_PHASE.PROCESS:
                this.renderProcess(main);
                break;
            case GAME_PHASE.EVENT:
                this.renderEvent(main);
                break;
            case GAME_PHASE.RESULT:
                this.renderResult(main);
                break;
        }
    }

    // 渲染状态栏
    renderStatus() {
        const scoreInfo = this.getDisplayScore();
        const scoreText = scoreInfo.feverBase > 0
            ? `${scoreInfo.settled} + ${scoreInfo.feverBase}×${scoreInfo.feverMultiplier.toFixed(1)} = ${scoreInfo.display}`
            : `${scoreInfo.display}`;
        document.getElementById('score-display').textContent = `得分: ${scoreText}`;

        // EVENT阶段隐藏行动点
        const actionPointsEl = document.getElementById('action-points');
        if (this.gamePhase === GAME_PHASE.EVENT) {
            actionPointsEl.style.display = 'none';
        } else {
            actionPointsEl.style.display = '';
            actionPointsEl.textContent = `行动点: ${this.actionPoints}`;
        }

        let phaseText = '-';
        if (this.gamePhase === GAME_PHASE.COLLECT) phaseText = '情报收集';
        else if (this.gamePhase === GAME_PHASE.PROCESS) phaseText = '情报处理';
        else if (this.gamePhase === GAME_PHASE.EVENT) phaseText = `第${this.currentTopic}话题`;
        else if (this.gamePhase === GAME_PHASE.RESULT) phaseText = '结算';

        document.getElementById('current-phase').textContent = `状态: ${phaseText}`;

        const feverStatus = document.getElementById('fever-status');
        if (this.feverActive) {
            feverStatus.textContent = `Fever: ${this.currentFeverMultiplier.toFixed(1)}x`;
            feverStatus.classList.add('active');
        } else {
            feverStatus.textContent = 'Fever: -';
            feverStatus.classList.remove('active');
        }
    }

    // 渲染 NPC 面板
    renderNPCs() {
        const npcList = document.getElementById('npc-list');
        npcList.innerHTML = '';

        // 获取当前EVENT阶段显示的情报（如有）
        let currentIntel = null;
        if (this.gamePhase === GAME_PHASE.EVENT) {
            // 有利情报选择阶段：只有选中情报后才显示NPC勾选
            if (this.eventPhase === 'good') {
                if (this.selectedGoodIntelId) {
                    currentIntel = this.allIntels.find(i => i.id === this.selectedGoodIntelId);
                }
                // 如果没有选中情报，currentIntel保持null，不显示勾选
            } else {
                // 不利情报阶段：始终显示当前情报
                const currentCard = this.getCurrentEventIntel();
                currentIntel = currentCard.intel;
            }
        }

        this.npcs.forEach(npc => {
            const card = document.createElement('div');
            card.className = 'npc-card';
            const numberDisplay = npc.number !== null ? this.renderDice(npc.number, 30) : '<span style="font-size: 15px; color: #888;">?</span>';
            const rateDisplay = npc.intelRate !== npc.baseIntelRate ?
                `初始: ${npc.baseIntelRate}% | 收集: ${npc.intelRate}%` :
                `好感度: ${npc.baseIntelRate}%`;

            // EVENT阶段显示NPC勾选
            let checkboxHtml = '';
            if (currentIntel && this.gamePhase === GAME_PHASE.EVENT) {
                let canUse = true;
                let statusText = '';
                let statusStyle = '';
                let isAutoChecked = false;

                // 检查NPC数字是否与情报数字匹配
                const numberMatches = npc.number !== null && currentIntel.numbers.includes(npc.number);

                if (npc.number === null) {
                    canUse = false;
                    statusText = '无骰子';
                    statusStyle = 'color: #666;';
                } else if (npc.knowsIntel(currentIntel)) {
                    // 对于有利情报：知晓则100%成功
                    if (currentIntel.isGood) {
                        statusText = '知情人';
                        statusStyle = 'color: #4ecca3;';
                    } else {
                        // 对于不利情报：知晓则不能使用
                        canUse = false;
                        statusText = '知情人';
                        statusStyle = 'color: #ff6b6b;';
                    }
                } else {
                    // 不知晓：按成功率判定
                    const successRate = npc.baseIntelRate / 100;
                    const roll = Math.random();
                    if (roll < successRate) {
                        statusText = '对齐成功';
                        statusStyle = 'color: #4ecca3;';
                        // 数字匹配则自动勾选
                        if (numberMatches) {
                            isAutoChecked = true;
                        }
                    } else {
                        canUse = false;
                        statusText = '对齐失败';
                        statusStyle = 'color: #ff6b6b;';
                    }
                }

                const disabled = !canUse ? 'disabled style="opacity: 0.5;"' : '';
                const isChecked = (isAutoChecked || this.selectedNPCsForEvent.has(npc.name)) ? 'checked' : '';
                checkboxHtml = `
                    <div style="margin-top: 5px;">
                        <label style="display: flex; align-items: center; gap: 4px; cursor: ${canUse ? 'pointer' : 'not-allowed'};">
                            <input type="checkbox" name="event-npc-select" value="${npc.name}" ${disabled} ${isChecked} ${!canUse ? '' : `onchange="game.handleEventNPCSelectionChange('${npc.name}', this.checked)"`}>
                            <span style="${statusStyle}">${statusText}</span>
                        </label>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="name">${npc.name} ${numberDisplay}</div>
                <div class="info">
                    <div class="friendliness">${rateDisplay}</div>
                    <div>${npc.role}</div>
                </div>
                ${checkboxHtml}
            `;
            npcList.appendChild(card);
        });
    }

    // 渲染开始界面
    renderSetup(container) {
        container.innerHTML = `
            <div class="welcome-screen">
                <h2>开始新游戏</h2>
                <p>选择难度</p>
                <div style="display: flex; gap: 20px; justify-content: center; margin-top: 20px;">
                    <button class="action-btn" onclick="game.startGame('easy')">简单</button>
                    <button class="action-btn" onclick="game.startGame('hard')">困难</button>
                </div>
            </div>
        `;
    }

    // 渲染情报收集阶段
    renderCollect(container) {
        // 按话题分组已收集的情报
        const collectedIntels = Array.from(this.collectedIntels).map(id =>
            this.allIntels.find(i => i.id === id)
        ).filter(i => i);

        const topicGroups = {};
        for (let i = 1; i <= 3; i++) {
            topicGroups[i] = collectedIntels.filter(intel => intel.topic === i);
        }

        // 渲染情报卡片（显示是否已处理）
        const renderIntelCardInCollect = (intel) => {
            const isProcessed = this.processedIntels.has(intel.id);
            const numbersHtml = this.renderDiceNumbers(intel.numbers, 48);

            return `
                <div class="intel-card ${intel.isGood ? '' : 'bad'} ${isProcessed ? 'completed' : ''}" style="${isProcessed ? 'opacity: 0.7;' : ''}">
                    <div class="intel-header">
                        <span class="intel-name">${intel.name}</span>
                        <span class="intel-score">${intel.score}分</span>
                    </div>
                    <div style="font-size: 12px; color: #aaa;">
                        ${intel.isGood ? '有利' : '不利'}情报
                        ${isProcessed ? '<span style="color: #4ecca3;">【已处理】</span>' : ''}
                    </div>
                    <div class="intel-numbers">
                        ${numbersHtml}
                    </div>
                </div>
            `;
        };

        container.innerHTML = `
            <div class="phase-panel">
                <h2>情报收集</h2>

                <div class="player-actions">
                    <h4>与 NPC 交流</h4>
                    <div class="action-buttons">
                        ${this.npcs.map(npc => `
                            ${this.interactedNPCs.has(npc.name) ?
                                `<button class="action-btn" disabled style="opacity: 0.5;">${npc.name} (已交互)</button>` :
                                `<button class="action-btn" onclick="game.collectFromNPC('${npc.name}')">${npc.name} (${npc.intelRate}%)</button>`
                            }
                        `).join('')}
                    </div>
                </div>

                ${Object.entries(topicGroups).map(([topic, intels]) => `
                    <div class="phase-header">
                        <div class="phase-title">话题 ${topic}</div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        ${intels.length === 0 ? '<p style="color: #888;">未收集到情报</p>' : ''}
                        ${intels.map(intel => renderIntelCardInCollect(intel)).join('')}
                    </div>
                `).join('')}

                <div style="margin-top: 30px; text-align: center;">
                    <button class="action-btn" onclick="game.startProcessStage()">进入情报处理</button>
                </div>
            </div>
        `;
    }

    // 渲染情报处理阶段
    renderProcess(container) {
        const collectedIntels = Array.from(this.collectedIntels).map(id =>
            this.allIntels.find(i => i.id === id)
        ).filter(i => i);

        // 按话题分组
        const topicGroups = {};
        collectedIntels.forEach(intel => {
            if (!topicGroups[intel.topic]) topicGroups[intel.topic] = [];
            topicGroups[intel.topic].push(intel);
        });

        // 渲染情报卡片
        const renderIntelCardInProcess = (intel) => {
            const isProcessed = this.processedIntelsInProcessStage.has(intel.id);
            const numbersHtml = this.renderDiceNumbers(intel.numbers, 48);

            return `
                <div class="intel-card ${intel.isGood ? '' : 'bad'}" style="${isProcessed ? 'opacity: 0.6;' : ''}">
                    <div class="intel-header">
                        <span class="intel-name">${intel.name}</span>
                        <span class="intel-score">${intel.score}分</span>
                    </div>
                    <div class="intel-numbers">
                        ${numbersHtml}
                        ${isProcessed ? '<span style="color: #4ecca3; margin-left: 8px;">【已处理】</span>' : ''}
                    </div>
                    <div style="margin-top: 10px;">
                        <button class="action-btn" onclick="game.processIntel('${intel.id}')" ${isProcessed ? 'disabled' : ''}>
                            尝试处理
                        </button>
                    </div>
                    <div style="margin-top: 8px; font-size: 12px; color: #888;">
                        ${this.npcs.map(npc => {
                            const isKnower = intel.knowers.includes(npc.name);
                            const pendingNpcs = this.pendingShares.get(intel.id) || [];
                            const isPending = pendingNpcs.includes(npc.name);
                            const numberDisplay = npc.number !== null ? this.renderDice(npc.number, 30) : '<span style="font-size: 15px; color: #888;">?</span>';
                            return `
                                <label style="display: inline-flex; align-items: center; margin: 3px 8px; padding: 3px 8px; background: #0f3460; border-radius: 4px; cursor: pointer;">
                                    <input type="checkbox" name="share-${intel.id}" value="${npc.name}" ${isKnower ? 'disabled style="opacity: 0.5;"' : ''} ${isPending ? 'checked' : ''} ${isKnower ? '' : `onchange="game.handleShareCheckboxChange('${intel.id}', '${npc.name}', this.checked)"`}>
                                    <span style="margin-left: 4px; ${isKnower ? 'color: #4ecca3;' : ''}">${npc.name}${numberDisplay}${isKnower ? '✓' : ''}</span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        };

        container.innerHTML = `
            <div class="phase-panel">
                <div class="player-actions">
                    <h4>情报列表</h4>
                </div>

                ${Object.entries(topicGroups).map(([topic, intels]) => `
                    <div class="phase-header">
                        <div class="phase-title">话题 ${topic}</div>
                    </div>
                    ${intels.map(intel => renderIntelCardInProcess(intel)).join('')}
                `).join('')}

                <div style="margin-top: 30px; text-align: center;">
                    <button class="action-btn" onclick="game.startTopic()">进入交涉</button>
                </div>
            </div>
        `;
    }

    // 渲染交涉进行阶段 - 卡牌游戏模式
    renderEvent(container) {
        const currentIntels = this.getCurrentTopicIntels();
        const unprocessed = currentIntels.filter(i => !this.processedIntels.has(i.id));
        const badIntels = unprocessed.filter(i => !i.isGood);
        const goodIntels = unprocessed.filter(i => i.isGood);

        const currentCard = this.getCurrentEventIntel();

        let content = `
            <div class="phase-panel">
        `;

        // 渲染当前卡牌（不利情报阶段）
        const isBonusMode = this.bonusIntelId !== null;
        if (currentCard.intel && currentCard.phase === 'bad' && !isBonusMode) {
            content += this.renderCurrentEventCard(currentCard, badIntels.length, goodIntels.length);
        } else if (isBonusMode && this.bonusIntelId !== null) {
            // 加成判定模式
            const bonusIntel = this.allIntels.find(i => i.id === this.bonusIntelId);
            if (bonusIntel) {
                content += this.renderCurrentEventCard({
                    intel: bonusIntel,
                    phase: 'bad',
                    index: this.eventBadIntelIndex,
                    total: this.originalBadIntelCount,
                    type: 'bonus'
                }, badIntels.length, goodIntels.length);
            }
        } else if (this.eventPhase === 'good' && goodIntels.length > 0) {
            // 有利情报阶段 - 如果已选择情报，显示选中的卡片
            if (this.selectedGoodIntelId) {
                const selectedIntel = this.allIntels.find(i => i.id === this.selectedGoodIntelId);
                if (selectedIntel) {
                    const numbersHtml = this.renderDiceNumbers(selectedIntel.numbers, 56);
                    content += `
                        <div class="intel-card" style="max-width: 600px; margin: 0 auto;">
                            <div class="intel-header">
                                <span class="intel-name">${selectedIntel.name}</span>
                                <span class="intel-score">${selectedIntel.score}分</span>
                            </div>
                            <div class="intel-numbers">
                                ${numbersHtml}
                            </div>
                            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #0a1628;">
                                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                    <button class="action-btn" onclick="game.handleSelectedGoodIntel('${selectedIntel.id}')" style="flex: 1; min-width: 120px;">
                                        投骰子
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else {
                // 显示有利情报列表
                content += `
                    <div style="margin-bottom: 20px;">
                        <h3 style="color: #4ecca3; margin-bottom: 15px;">选择有利情报打出</h3>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;">
                        ${goodIntels.map(intel => {
                            const numbersHtml = this.renderDiceNumbers(intel.numbers, 48);
                            return `
                                <div class="intel-card" style="cursor: pointer; transition: transform 0.2s; max-width: 280px;"
                                    onclick="game.selectGoodIntel('${intel.id}')"
                                    onmouseover="this.style.transform='scale(1.02)'"
                                    onmouseout="this.style.transform='scale(1)'">
                                    <div class="intel-header">
                                        <span class="intel-name">${intel.name}</span>
                                        <span class="intel-score">${intel.score}分</span>
                                    </div>
                                    <div class="intel-numbers">
                                        ${numbersHtml}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        } else if (currentCard.phase === 'complete') {
            content += `
                <div style="text-align: center; padding: 40px 20px; background: #0f3460; border-radius: 8px;">
                    <h3 style="color: #4ecca3; margin-bottom: 20px;">本话题所有情报已处理完毕</h3>
                    <button class="action-btn" onclick="game.nextTopic()">
                        ${this.currentTopic >= GAME_CONFIG.TOPIC_COUNT ? '进入结算' : '下一话题'}
                    </button>
                </div>
            `;
        }

        container.innerHTML = content;
    }

    // 选择要打出的有利情报
    selectGoodIntel(IntelId) {
        const intel = this.allIntels.find(i => i.id === IntelId);
        if (!intel) return;

        // 记录当前选中的有利情报，显示NPC勾选
        this.selectedGoodIntelId = IntelId;

        // 重新渲染以显示NPC勾选
        this.render();
    }

    // 处理选中的有利情报
    handleSelectedGoodIntel(IntelId) {
        const intel = this.allIntels.find(i => i.id === IntelId);
        const manuallySelected = Array.from(this.selectedNPCsForEvent);
        // 添加数字匹配的NPC
        const autoMatched = intel ? this.npcs
            .filter(npc => npc.number !== null && intel.numbers.includes(npc.number))
            .map(npc => npc.name) : [];
        // 合并并去重
        const selectedNpcs = [...new Set([...manuallySelected, ...autoMatched])];

        const result = this.playGoodIntel(IntelId, selectedNpcs);

        // 清理选中的有利情报，隐藏NPC勾选
        this.selectedGoodIntelId = null;

        if (result.success !== undefined) {
            // 打出成功或失败，都进入下一张
            this.eventGoodIntelIndex++;

            // 检查是否全部完成
            const goodIntels = this.getCurrentTopicGoodIntels();
            if (this.eventGoodIntelIndex >= goodIntels.length) {
                this.eventPhase = 'complete';
            }

            this.render();
        }

        // 清理 NPC 勾选状态
        this.selectedNPCsForEvent.clear();
    }

    // 跳过剩余有利情报，结束本话题
    skipRemainingGoodIntels() {
        const goodIntels = this.getCurrentTopicGoodIntels();
        goodIntels.forEach(intel => {
            if (!this.processedIntels.has(intel.id)) {
                this.skipGoodIntel(intel.id);
            }
        });
        this.eventPhase = 'complete';
        this.log(`跳过剩余 ${goodIntels.length} 个有利情报`, 'info');
        this.render();
    }

    // 返回有利情报选择列表
    backToGoodIntelSelection() {
        this.render();
    }

    // 渲染当前交涉卡牌
    renderCurrentEventCard(currentCard, badTotal, goodTotal) {
        const intel = currentCard.intel;
        const numbersHtml = this.renderDiceNumbers(intel.numbers, 56);

        let phaseTitle, phaseColor, actionText;
        const isBonusMode = this.bonusIntelId !== null;

        if (isBonusMode) {
            phaseTitle = '加成判定';
            phaseColor = '#f9ed69';
            actionText = '加成';
        } else if (currentCard.phase === 'bad') {
            phaseTitle = '不利情报';
            phaseColor = '#ff6b6b';
            actionText = '解决';
        } else {
            phaseTitle = '有利情报';
            phaseColor = '#4ecca3';
            actionText = '加成';
        }

        // 按钮 onclick 根据是否是加成模式
        const buttonAction = isBonusMode ? 'game.applyBonusToCurrent()' : 'game.handleCurrentCard()';

        return `
            <div class="intel-card ${intel.isGood ? '' : 'bad'}" style="max-width: 600px; margin: 0 auto; ${isBonusMode ? 'border-color: #f9ed69;' : ''}">
                <div class="intel-header">
                    <span class="intel-name">${intel.name}</span>
                    <span class="intel-score">${intel.score}分</span>
                </div>
                <div style="font-size: 12px; color: ${phaseColor}; margin-bottom: 10px;">
                    ${isBonusMode ? '加成判定' : `第 ${currentCard.index + 1}/${currentCard.total} 张 - ${phaseTitle}`}
                </div>
                <div class="intel-numbers">
                    ${numbersHtml}
                </div>

                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #0a1628;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="action-btn" onclick="${buttonAction}" style="flex: 1; min-width: 120px;">
                            投骰子${actionText}
                        </button>
                        ${!isBonusMode && currentCard.type === 'play' ? `
                            <button class="action-btn cancel-btn" onclick="game.skipCurrentCard()">
                                跳过
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // 检查 NPC 是否可用于当前情报
    canUseNpcForIntel(npcName, intel) {
        const npc = this.npcs.find(n => n.name === npcName);
        if (!npc || npc.number === null) return false;

        if (intel.isGood) {
            // 有利情报：知晓则100%成功，不知晓则按成功率
            return true;
        } else {
            // 不利情报：知晓则不能使用，不知晓则按成功率
            return !npc.knowsIntel(intel);
        }
    }

    // 处理当前卡牌
    handleCurrentCard() {
        const currentCard = this.getCurrentEventIntel();
        if (!currentCard.intel) return;

        // 获取选中的 NPC（包括手动选择和自动匹配的）
        const manuallySelected = Array.from(this.selectedNPCsForEvent);
        // 添加数字匹配的NPC
        const autoMatched = this.npcs
            .filter(npc => npc.number !== null && currentCard.intel.numbers.includes(npc.number))
            .map(npc => npc.name);
        // 合并并去重
        const selectedNpcs = [...new Set([...manuallySelected, ...autoMatched])];

        if (currentCard.phase === 'bad') {
            this.resolveCurrentBadIntel(selectedNpcs);
        } else {
            this.playCurrentGoodIntel(selectedNpcs);
        }

        // 清理 NPC 勾选状态
        this.selectedNPCsForEvent.clear();
    }

    // 解决当前不利情报
    resolveCurrentBadIntel(selectedNpcs) {
        const currentCard = this.getCurrentEventIntel();
        if (!currentCard.intel || currentCard.phase !== 'bad') return;

        const result = this.resolveBadIntel(currentCard.intel.id, selectedNpcs);

        if (result.success && result.needBonus) {
            // 解决成功，需要进入加成阶段
            this.bonusIntelId = currentCard.intel.id;
            this.log(`解决成功！现在进行加成判定...`, 'success');
            this.render();
        } else if (result.success === false) {
            // 解决失败，标记为已处理
            this.processedIntels.add(currentCard.intel.id);
            this.eventBadIntelIndex++;
            this.bonusIntelId = null;

            // 检查是否需要切换到有利情报阶段
            if (this.eventBadIntelIndex >= this.originalBadIntelCount) {
                this.eventPhase = 'good';
            }

            this.render();
        }
    }

    // 加成当前情报（解决不利情报成功后）
    applyBonusToCurrent() {
        if (!this.bonusIntelId) return;

        const intel = this.allIntels.find(i => i.id === this.bonusIntelId);
        const manuallySelected = Array.from(this.selectedNPCsForEvent);
        // 添加数字匹配的NPC
        const autoMatched = intel ? this.npcs
            .filter(npc => npc.number !== null && intel.numbers.includes(npc.number))
            .map(npc => npc.name) : [];
        // 合并并去重
        const selectedNpcs = [...new Set([...manuallySelected, ...autoMatched])];

        const result = this.applyBonus(this.bonusIntelId, selectedNpcs);

        if (result.success !== undefined && !result.needBonus) {
            // 加成完成，将情报标记为已处理
            this.processedIntels.add(this.bonusIntelId);

            // 进入下一张卡
            this.eventBadIntelIndex++;
            this.bonusIntelId = null;

            // 检查是否需要切换到有利情报阶段
            if (this.eventBadIntelIndex >= this.originalBadIntelCount) {
                this.eventPhase = 'good';
            }

            this.render();
        }

        // 清理 NPC 勾选状态
        this.selectedNPCsForEvent.clear();
    }

    // 跳过当前不利情报
    skipCurrentBadIntel() {
        const currentCard = this.getCurrentEventIntel();
        if (!currentCard.intel || currentCard.phase !== 'bad') return;

        const intel = currentCard.intel;
        this.processedIntels.add(intel.id);
        this.log(`跳过不利情报 "${intel.name}"`, 'info');

        // 进入下一张卡
        this.eventBadIntelIndex++;

        if (this.eventBadIntelIndex >= this.originalBadIntelCount) {
            this.eventPhase = 'good';
        }

        this.render();
    }

    // 打出当前有利情报
    playCurrentGoodIntel(selectedNpcs) {
        const currentCard = this.getCurrentEventIntel();
        if (!currentCard.intel || currentCard.phase !== 'good') return;

        const result = this.playGoodIntel(currentCard.intel.id, selectedNpcs);

        if (result.success !== undefined) {
            // 进入下一张卡
            this.eventGoodIntelIndex++;

            // 检查是否全部完成
            const goodIntels = this.getCurrentTopicGoodIntels();
            if (this.eventGoodIntelIndex >= goodIntels.length) {
                this.eventPhase = 'complete';
            }

            this.render();
        }
    }

    // 跳过当前有利情报
    skipCurrentGoodIntel() {
        const currentCard = this.getCurrentEventIntel();
        if (!currentCard.intel || currentCard.phase !== 'good') return;

        const intel = currentCard.intel;
        this.skipGoodIntel(intel.id);

        // 进入下一张卡
        this.eventGoodIntelIndex++;

        const goodIntels = this.getCurrentTopicGoodIntels();
        if (this.eventGoodIntelIndex >= goodIntels.length) {
            this.eventPhase = 'complete';
        }

        this.render();
    }

    // 跳过当前卡牌（统一入口）
    skipCurrentCard() {
        const currentCard = this.getCurrentEventIntel();
        if (!currentCard.intel) return;

        if (currentCard.phase === 'bad') {
            this.skipCurrentBadIntel();
        } else {
            this.skipCurrentGoodIntel();
        }

        // 清理 NPC 勾选状态
        this.selectedNPCsForEvent.clear();
    }

    // 渲染情报卡片
    renderIntelCard(intel, showBadActions = false, showGoodActions = false) {
        const numbersHtml = this.renderDiceNumbers(intel.numbers, 48);

        const isProcessed = this.processedIntels.has(intel.id);
        const typeText = intel.isGood ? '有利' : '不利';

        let actionsHtml = '';

        if (!isProcessed) {
            if (showBadActions) {
                actionsHtml = `
                    <div style="margin-top: 10px;">
                        <button class="action-btn" onclick="game.resolveBadIntel('${intel.id}')">
                            尝试解决
                        </button>
                    </div>
                `;
            } else if (showGoodActions) {
                actionsHtml = `
                    <div style="margin-top: 10px;">
                        <button class="action-btn" onclick="game.playGoodIntel('${intel.id}')">
                            投骰子
                        </button>
                        <button class="action-btn cancel-btn" onclick="game.skipGoodIntel('${intel.id}')">
                            跳过
                        </button>
                    </div>
                `;
            }
        }

        return `
            <div class="intel-card ${intel.isGood ? '' : 'bad'}">
                <div class="intel-header">
                    <span class="intel-name">${intel.name}</span>
                    <span class="intel-score">${intel.score}分</span>
                </div>
                <div style="font-size: 12px; color: #aaa;">${typeText}情报</div>
                <div class="intel-numbers">
                    ${numbersHtml}
                </div>
                ${actionsHtml}
            </div>
        `;
    }

    // 渲染结算界面
    renderResult(container) {
        const result = this.finalResult;
        let resultText, resultClass;

        if (result.rating === 'perfect') {
            resultText = '完美达成！';
            resultClass = 'perfect';
        } else if (result.rating === 'success') {
            resultText = '事件成功！';
            resultClass = 'success';
        } else {
            resultText = '事件失败';
            resultClass = 'fail';
        }

        container.innerHTML = `
            <div class="result-panel ${resultClass}">
                <h2>${resultText}</h2>
                <div class="score-display">
                    <div class="final">${result.totalScore.toFixed(0)}</div>
                </div>
                <div style="margin-top: 40px;">
                    <button class="action-btn" onclick="game.restart()">再来一局</button>
                </div>
            </div>
        `;
    }
}

// 初始化游戏
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new Game();
    game.render();
});
