import { EIP712Signer } from "./signer";
import { Provider } from "./provider";
import { EIP712_TX_TYPE, serializeEip712 } from "./utils";
import { ethers, ProgressCallback } from "ethers";
import { TransactionLike, TransactionRequest, TransactionResponse } from "./types";
import { AdapterL1, AdapterL2 } from "./adapters";

export class Wallet extends AdapterL2(AdapterL1(ethers.Wallet)) {
    // @ts-ignore
    override readonly provider: Provider;
    providerL1?: ethers.Provider;
    // @ts-ignore
    public eip712: EIP712Signer;

    // Methods managing L1, L2, and EIP712 provider

    // Returns L1 provider
    override _providerL1() {
        if (this.providerL1 == null) {
            throw new Error("L1 provider missing: use `connectToL1` to specify");
        }
        return this.providerL1;
    }

    // Returns L2 provider
    override _providerL2() {
        return this.provider;
    }

    // Returns signer for L1
    override _signerL1() {
        return this.ethWallet();
    }

    // Returns signer for L2
    override _signerL2() {
        return this;
    }

    // Creates an Ethereum wallet
    ethWallet(): ethers.Wallet {
        return new ethers.Wallet(this.signingKey, this._providerL1());
    }

    // Connects to L2 provider
    override connect(provider: Provider): Wallet {
        return new Wallet(this.signingKey, provider, this.providerL1);
    }

    // Connects to L1 provider
    connectToL1(provider: ethers.Provider): Wallet {
        return new Wallet(this.signingKey, this.provider, provider);
    }

    // Creates a wallet from mnemonic
    static fromMnemonic(mnemonic: string, provider?: ethers.Provider): Wallet {
        const wallet = super.fromPhrase(mnemonic, provider);
        return new Wallet(wallet.signingKey, undefined, wallet.provider as ethers.Provider);
    }

    // Creates a wallet from encrypted JSON (asynchronous)
    static override async fromEncryptedJson(
        json: string,
        password: string | Uint8Array,
        callback?: ProgressCallback,
    ): Promise<Wallet> {
        const wallet = await super.fromEncryptedJson(json, password, callback);
        return new Wallet(wallet.signingKey);
    }

    // Creates a wallet from encrypted JSON (synchronous)
    static override fromEncryptedJsonSync(json: string, password: string | Uint8Array): Wallet {
        const wallet = super.fromEncryptedJsonSync(json, password);
        return new Wallet(wallet.signingKey);
    }

    // Constructor to create a wallet
    constructor(
        privateKey: string | ethers.SigningKey,
        providerL2?: Provider,
        providerL1?: ethers.Provider,
    ) {
        super(privateKey, providerL2);
        // @ts-ignore
        if (this.provider != null) {
            const network = this.provider.getNetwork();
            // @ts-ignore
            this.eip712 = new EIP712Signer(
                this,
                network.then((n) => Number(n.chainId)),
            );
        }
        this.providerL1 = providerL1;
    }

    // Method to populate a transaction object with necessary details
    override async populateTransaction(transaction: TransactionRequest): Promise<TransactionLike> {
        // Default transaction type when custom data is not provided
        if (transaction.type == null && transaction.customData == null) {
            transaction.type = 0;
        }

        // Check for custom data and transaction type
        if (transaction.customData == null && transaction.type != EIP712_TX_TYPE) {
            return (await super.populateTransaction(transaction)) as TransactionLike;
        }

        // Set transaction type and prepare data for EIP712
        transaction.type = EIP712_TX_TYPE;
        const populated = (await super.populateTransaction(transaction)) as TransactionLike;

        // Set default values for transaction fields if not provided
        populated.type = EIP712_TX_TYPE;
        populated.value ??= 0;
        populated.data ??= "0x";

        // Retrieve gas price
        const gasPrice = await this.provider.getGasPrice();
        populated.gasPrice = gasPrice;

        return populated;
    }

    // Method to sign the transaction
    override async signTransaction(transaction: TransactionRequest): Promise<string> {
        // Default transaction signing when custom data is not provided
        if (transaction.customData == null && transaction.type != EIP712_TX_TYPE) {
            if (transaction.type == 2 && transaction.maxFeePerGas == null) {
                transaction.maxFeePerGas = await this.provider.getGasPrice();
            }
            return await super.signTransaction(transaction);
        } else {
            // Handle transactions with custom data and validate the sender's address
            transaction.from ??= this.address;
            const from = await ethers.resolveAddress(transaction.from);

            // Address matching check
            if (from.toLowerCase() != this.address.toLowerCase()) {
                throw new Error("Transaction `from` address mismatch");
            }

            // Prepare and sign EIP712 data
            transaction.customData ??= {};
            transaction.customData.customSignature = await this.eip712.sign(transaction);
            const populated = await this.populateTransaction(transaction);

            return serializeEip712(populated);
        }
    }
}
