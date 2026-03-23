import { Schema, MapSchema, type } from '@colyseus/schema';

export class AgentState extends Schema {
    @type('string') id: string;
    @type('string') name: string;
    @type('number') x: number;
    @type('number') y: number;
    @type('string') direction: 'up' | 'down' | 'left' | 'right';
    @type('string') action: string;
    @type('string') currentTask: string;
    @type('string') taskStage: string;
    @type('string') thought: string;

    constructor(id: string, name: string) {
        super();
        this.id = id;
        this.name = name;
        this.x = 0;
        this.y = 0;
        this.direction = 'down';
        this.action = 'idle';
        this.currentTask = '';
        this.taskStage = '';
        this.thought = '';
    }
}

export class OfficeState extends Schema {
    @type({ map: AgentState }) agents = new MapSchema<AgentState>();
    @type('string') officeTime: string = new Date().toISOString();
    @type('number') timeScale: number = 1;
    @type('boolean') paused: boolean = false; // Agents run by default — frontend is an observer

    createAgent(id: string, name: string) {
        this.agents.set(id, new AgentState(id, name));
    }

    removeAgent(id: string) {
        this.agents.delete(id);
    }
}
