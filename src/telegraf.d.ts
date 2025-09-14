// Minimal Telegraf declarations for compilation without full dependency
// This stub provides only the pieces of API used in the project.

declare module 'telegraf' {
  import { EventEmitter } from 'events';

  export interface Context {
    chat?: { id: number };
    from?: { id: number; username?: string; first_name?: string };
    message?: any;
    callbackQuery?: any;
    reply(text: string, extra?: any): Promise<any>;
  }

  export class Telegraf<C extends Context = Context> extends EventEmitter {
    constructor(token: string);
    use(...middlewares: any[]): this;
    command(command: string | string[], handler: (ctx: C) => any): this;
    on(event: string, handler: (ctx: C) => any): this;
    launch(): Promise<void>;
    stop(reason?: string): void;
    catch(handler: (err: any, ctx: C) => any): void;
    telegram: any;
  }

  export const Markup: any;
}

declare module 'telegraf/typings/core/types/typegram' {
  export type Message = any;
}

