// 情报类型
const INTEL_TYPES = {
    SECRET: 'secret',       // 秘密情报
    PUBLIC: 'public',      // 公开情报
    RUMOR: 'rumor'         // 小道情报
};

// 情报类
class Intel {
    constructor(id, name, topic, isGood, score, numbers = null) {
        this.id = id;
        this.name = name;
        this.topic = topic; // 所属话题
        this.isGood = isGood; // true=有利, false=不利
        this.score = score; // 100 或 300

        // 生成数字
        // 100分情报：3个数字
        // 300分情报：2个数字
        // 数字 1-6，数字间不能相同
        if (numbers) {
            this.numbers = numbers;
        } else {
            this.numbers = this.generateNumbers();
        }

        // 知晓该情报的 NPC ID 列表
        this.knowers = [];

        // 情报类型
        this.type = this.determineType();
    }

    // 生成不重复的数字
    generateNumbers() {
        const count = this.score === 100 ? 3 : 2;
        const nums = new Set();

        while (nums.size < count) {
            nums.add(Math.floor(Math.random() * 6) + 1);
        }

        return Array.from(nums);
    }

    // 添加知情人 NPC
    addKnower(npcId) {
        if (!this.knowers.includes(npcId)) {
            this.knowers.push(npcId);
        }
    }

    // 判断情报类型
    determineType() {
        const knowerCount = this.knowers.length;

        if (this.isGood) {
            // 有利情报默认是公开的
            if (this.knowers.length === 1) {
                return INTEL_TYPES.SECRET;
            }
            return INTEL_TYPES.PUBLIC;
        }

        // 不利情报处理
        if (knowerCount === 1) {
            return INTEL_TYPES.SECRET;
        } else if (this.knowers.length >= 3) {
            // 多个知情人中，如果随机决定是公开还是小道
            return Math.random() < 0.5 ? INTEL_TYPES.PUBLIC : INTEL_TYPES.RUMOR;
        }

        return INTEL_TYPES.PUBLIC;
    }

    // 随机添加一个数字（情报处理）
    addRandomNumber() {
        const existing = new Set(this.numbers);
        const available = [1, 2, 3, 4, 5, 6].filter(n => !existing.has(n));

        if (available.length > 0) {
            const newNum = available[Math.floor(Math.random() * available.length)];
            this.numbers.push(newNum);
            return newNum;
        }
        return null;
    }

    // 获取情报描述
    getDescription() {
        const typeMap = {
            [INTEL_TYPES.SECRET]: '秘密情报',
            [INTEL_TYPES.PUBLIC]: '公开情报',
            [INTEL_TYPES.RUMOR]: '小道情报'
        };

        return {
            name: this.name,
            type: typeMap[this.type],
            score: this.score,
            numbers: this.numbers,
            knowers: this.knowers,
            isGood: this.isGood
        };
    }
}

// 情报生成器
class IntelGenerator {
    constructor() {
        this.idCounter = 0;
    }

    // 生成单个情报
    createIntel(topic, isGood, score, knowers = []) {
        const id = `intel_${++this.idCounter}`;
        const name = this.generateIntelName(topic, isGood);
        const intel = new Intel(id, name, topic, isGood, score);

        // 设置知情人
        knowers.forEach(npcId => intel.addKnower(npcId));

        return intel;
    }

    // 生成情报名称
    generateIntelName(topic, isGood) {
        const goodNames = {
            1: ['需求确认', '方案通过', '资源到位'],
            2: ['进度顺利', '代码质量好', '测试通过'],
            3: ['上线成功', '用户反馈好', '数据达标']
        };

        const badNames = {
            1: ['需求变更', '资源短缺', '方案被拒'],
            2: ['Bug 过多', '进度延迟', '测试失败'],
            3: ['上线事故', '用户投诉', '数据异常']
        };

        const names = isGood ? goodNames[topic] : badNames[topic];
        return names[Math.floor(Math.random() * names.length)];
    }

    // 根据难度生成话题情报（只生成基础情报，不负责NPC分配）
    generateTopicIntels(topic, difficulty, npcs) {
        const intels = [];
        const topicNum = parseInt(topic);

        // 获取难度配置
        const config = GAME_CONFIG[difficulty.toUpperCase()];

        // 不利情报
        for (let i = 0; i < config.BAD_INTEL_COUNT; i++) {
            const knowers = this.pickKnowers(npcs, 1);
            const intel = this.createIntel(topicNum, false, 100, knowers);
            intels.push(intel);
        }

        // 有利情报
        for (let i = 0; i < config.GOOD_300_COUNT; i++) {
            const intel = this.createIntel(topicNum, true, 300, this.pickKnowers(npcs, 2));
            intels.push(intel);
        }
        for (let i = 0; i < config.GOOD_100_COUNT; i++) {
            const intel = this.createIntel(topicNum, true, 100, this.pickKnowers(npcs, 1));
            intels.push(intel);
        }

        return intels;
    }

    // 为所有NPC分配情报，确保每个NPC至少有一个情报
    distributeIntelsToNPCs(allIntels, npcs) {
        const npcNames = npcs.map(npc => npc.name);
        const npcsWithoutIntel = [];

        // 找出没有情报的NPC
        npcNames.forEach(npcName => {
            const hasIntel = allIntels.some(intel => intel.knowers.includes(npcName));
            if (!hasIntel) {
                npcsWithoutIntel.push(npcName);
            }
        });

        // 为没有情报的NPC添加一个情报
        npcsWithoutIntel.forEach(npcName => {
            // 随机选择一个现有情报添加到知情人
            const randomIntel = allIntels[Math.floor(Math.random() * allIntels.length)];
            randomIntel.addKnower(npcName);
        });
    }

    // 随机选择知情人
    pickKnowers(npcs, count) {
        const shuffled = npcs.sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count).map(npc => npc.name);
    }
}
