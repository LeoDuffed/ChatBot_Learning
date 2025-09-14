export interface SerializerProtocol {
    dumpsTyped(data: any): Promise<[string, Uint8Array]>;
    loadsTyped(type: string, data: Uint8Array | string): Promise<any>;
}
