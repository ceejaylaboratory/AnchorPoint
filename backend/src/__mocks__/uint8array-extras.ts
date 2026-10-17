const objectToString = Object.prototype.toString;
const uint8ArrayStringified = '[object Uint8Array]';
const arrayBufferStringified = '[object ArrayBuffer]';

function isType(value: any, typeConstructor: any, typeStringified: string) {
	if (!value) {
		return false;
	}

	if (value.constructor === typeConstructor) {
		return true;
	}

	return objectToString.call(value) === typeStringified;
}

export function isUint8Array(value: any): boolean {
	return isType(value, Uint8Array, uint8ArrayStringified);
}

function isArrayBuffer(value: any): boolean {
	return isType(value, ArrayBuffer, arrayBufferStringified);
}

function isUint8ArrayOrArrayBuffer(value: any): boolean {
	return isUint8Array(value) || isArrayBuffer(value);
}

export function assertUint8Array(value: any): void {
	if (!isUint8Array(value)) {
		throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof value}\``);
	}
}

export function assertUint8ArrayOrArrayBuffer(value: any): void {
	if (!isUint8ArrayOrArrayBuffer(value)) {
		throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
	}
}

export function toUint8Array(value: any): Uint8Array {
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}

	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}

	throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}

export function concatUint8Arrays(arrays: Uint8Array[], totalLength?: number): Uint8Array {
	if (arrays.length === 0) {
		return new Uint8Array(0);
	}

	totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.length, 0);

	const returnValue = new Uint8Array(totalLength);

	let offset = 0;
	for (const array of arrays) {
		assertUint8Array(array);
		returnValue.set(array, offset);
		offset += array.length;
	}

	return returnValue;
}

export function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
	assertUint8Array(a);
	assertUint8Array(b);

	if (a === b) {
		return true;
	}

	if (a.length !== b.length) {
		return false;
	}

	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) {
			return false;
		}
	}

	return true;
}

export function compareUint8Arrays(a: Uint8Array, b: Uint8Array): number {
	assertUint8Array(a);
	assertUint8Array(b);

	const length = Math.min(a.length, b.length);

	for (let index = 0; index < length; index++) {
		const diff = a[index] - b[index];
		if (diff !== 0) {
			return Math.sign(diff);
		}
	}

	return Math.sign(a.length - b.length);
}

const cachedDecoders: Record<string, TextDecoder> = {
	utf8: new globalThis.TextDecoder('utf8'),
};

export function uint8ArrayToString(array: Uint8Array | ArrayBuffer, encoding = 'utf8'): string {
	assertUint8ArrayOrArrayBuffer(array);
	cachedDecoders[encoding] ??= new globalThis.TextDecoder(encoding);
	return cachedDecoders[encoding].decode(array);
}

function assertString(value: any): void {
	if (typeof value !== 'string') {
		throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
	}
}

const cachedEncoder = new globalThis.TextEncoder();

export function stringToUint8Array(string: string): Uint8Array {
	assertString(string);
	return cachedEncoder.encode(string);
}

function base64ToBase64Url(base64: string): string {
	return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBase64(base64url: string): string {
	const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
	const padding = (4 - (base64.length % 4)) % 4;
	return base64 + '='.repeat(padding);
}

const MAX_BLOCK_SIZE = 65_535;

export function uint8ArrayToBase64(array: Uint8Array, { urlSafe = false }: { urlSafe?: boolean } = {}): string {
	assertUint8Array(array);

	let base64 = '';

	for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
		const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
		base64 += globalThis.btoa(String.fromCodePoint.apply(undefined, chunk as unknown as number[]));
	}

	return urlSafe ? base64ToBase64Url(base64) : base64;
}

export function base64ToUint8Array(base64String: string): Uint8Array {
	assertString(base64String);
	return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0)!);
}

export function stringToBase64(string: string, { urlSafe = false }: { urlSafe?: boolean } = {}): string {
	assertString(string);
	return uint8ArrayToBase64(stringToUint8Array(string), { urlSafe });
}

export function base64ToString(base64String: string): string {
	assertString(base64String);
	return uint8ArrayToString(base64ToUint8Array(base64String));
}

const byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'));

export function uint8ArrayToHex(array: Uint8Array): string {
	assertUint8Array(array);

	let hexString = '';
	for (let index = 0; index < array.length; index++) {
		hexString += byteToHexLookupTable[array[index]];
	}

	return hexString;
}

const hexToDecimalLookupTable: Record<string, number> = {
	0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
	a: 10, b: 11, c: 12, d: 13, e: 14, f: 15,
	A: 10, B: 11, C: 12, D: 13, E: 14, F: 15,
};

export function hexToUint8Array(hexString: string): Uint8Array {
	assertString(hexString);

	if (hexString.length % 2 !== 0) {
		throw new Error('Invalid Hex string length.');
	}

	const resultLength = hexString.length / 2;
	const bytes = new Uint8Array(resultLength);

	for (let index = 0; index < resultLength; index++) {
		const highNibble = hexToDecimalLookupTable[hexString[index * 2]];
		const lowNibble = hexToDecimalLookupTable[hexString[(index * 2) + 1]];

		if (highNibble === undefined || lowNibble === undefined) {
			throw new Error(`Invalid Hex character encountered at position ${index * 2}`);
		}

		bytes[index] = (highNibble << 4) | lowNibble;
	}

	return bytes;
}

export function getUintBE(view: DataView): number | undefined {
	const { byteLength } = view;

	if (byteLength === 6) {
		return (view.getUint16(0) * (2 ** 32)) + view.getUint32(2);
	}
	if (byteLength === 5) {
		return (view.getUint8(0) * (2 ** 32)) + view.getUint32(1);
	}
	if (byteLength === 4) {
		return view.getUint32(0);
	}
	if (byteLength === 3) {
		return (view.getUint8(0) * (2 ** 16)) + view.getUint16(1);
	}
	if (byteLength === 2) {
		return view.getUint16(0);
	}
	if (byteLength === 1) {
		return view.getUint8(0);
	}
	return undefined;
}

export function indexOf(array: Uint8Array, value: Uint8Array): number {
	const arrayLength = array.length;
	const valueLength = value.length;

	if (valueLength === 0 || valueLength > arrayLength) {
		return -1;
	}

	const validOffsetLength = arrayLength - valueLength;

	for (let index = 0; index <= validOffsetLength; index++) {
		let isMatch = true;
		for (let index2 = 0; index2 < valueLength; index2++) {
			if (array[index + index2] !== value[index2]) {
				isMatch = false;
				break;
			}
		}

		if (isMatch) {
			return index;
		}
	}

	return -1;
}

export function includes(array: Uint8Array, value: Uint8Array): boolean {
	return indexOf(array, value) !== -1;
}
