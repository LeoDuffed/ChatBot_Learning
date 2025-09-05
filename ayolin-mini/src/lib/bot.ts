import { db } from "./db";

const OWNER_ID = process.env.MINI_OWNER_ID ?? "mini-owner"

export async function getOrCreateMyBot(){
    let bot = await db.chatbot.findFirst({ where: { ownerUserId: OWNER_ID } })
    if(!bot){
        bot = await db.chatbot.create({
            data: { ownerUserId: OWNER_ID, name: "Mini AYOLIN", salesEnabled: true },
        })
    } 
    return bot  
}