// NPC 类
class NPC {
    constructor(name, role, intelRate = null) {
        this.name = name;
        this.role = role;
        // 情报获取成功率 0-90 随机，上限 100
        this.baseIntelRate = intelRate !== null ? intelRate : Math.floor(Math.random() * 91); // 初始成功率（交涉阶段使用）
        this.intelRate = this.baseIntelRate; // 当前成功率（收集阶段会提升）
        this.knownIntels = []; // 该 NPC 知道的情报 ID
        this.number = null; // 数字在话题开始时生成
    }

    // 生成 1-6 的随机数字
    rollNumber() {
        return Math.floor(Math.random() * 6) + 1;
    }

    // 刷新数字（使用后调用）
    refreshNumber() {
        this.number = this.rollNumber();
    }

    // 设置知道的情报
    addIntel(Intel) {
        if (!this.knownIntels.includes(Intel.id)) {
            this.knownIntels.push(Intel.id);
        }
    }

    // 检查是否知道某情报
    knowsIntel(Intel) {
        return this.knownIntels.includes(Intel.id);
    }
}

// NPC 池
const NPC_POOL = [
    { name: '天哥', role: '组长' },
    { name: '雨姐', role: '对方组长' },
    { name: '陈珂', role: 'PM' },
    { name: '陈老师', role: 'UI' }
];

// 从池中随机获取 NPC
function getRandomNPCs(count, existingNPCs = []) {
    const available = NPC_POOL.filter(npc =>
        !existingNPCs.some(en => en.name === npc.name)
    );

    const shuffled = available.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(npc => new NPC(npc.name, npc.role));
}

// 创建 NPC 实例（带情报获取成功率）
function createNPC(name, role, intelRate = null) {
    return new NPC(name, role, intelRate);
}
