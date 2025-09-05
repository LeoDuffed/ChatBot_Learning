import { 
    randomBytes,
    scrypt as _scrypt, 
    timingSafeEqual 
} from "crypto";
import { promisify } from "util";

const scrypt = promisify(_scrypt)

export async function hashSalesPassword(password: string){
    const salt = randomBytes(16)
    const dk = (await scrypt(password, salt, 64)) as Buffer
    return `scrypt:${salt.toString("hex")}:${dk.toString("hex")}`
}

export async function verifySalesPassword(password: string, stored?: string | null){
    if(!stored) return false
    const [algo, saltHex, keyHex] = stored.split(":")
    if(algo !== "scrypt" || !saltHex || !keyHex) return false
    const salt = Buffer.from(saltHex, "hex")
    const key = Buffer.from(keyHex, "hex")
    const dk = (await scrypt(password, salt, 64)) as Buffer
    return timingSafeEqual(dk, key)
}