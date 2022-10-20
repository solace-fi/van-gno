const ethers = require("ethers");
const BN = ethers.BigNumber;
const ethersUtils = require("ethereumjs-util");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const { isDeployed, sleeper } = require("./utils");
const settings = require("./settings");

const factoryAbi   = JSON.parse(fs.readFileSync("./data/abi/GnosisSafeProxyFactory.json").toString());
const singletonAbi = JSON.parse(fs.readFileSync("./data/abi/GnosisSafe.json").toString());

async function main() {
  await verifySettings();
  await setupProviders();
  await verifyDeployments();
  checkFilesystem();
  const safes = await getSafes();
  await deploySafes(safes);
}

// bare minimum of verifying safe params
async function verifySettings() {
  const errors = [];
  if(!ethers.utils.isAddress(settings.factoryAddress)) errors.push(`Factory address invalid (${settings.factoryAddress})`);
  if(!ethers.utils.isAddress(settings.singletonAddress)) errors.push(`Singleton address invalid (${settings.singletonAddress})`);
  if(settings.owners.length === 0) errors.push("No owners");
  for(let i = 0; i < settings.owners.length; ++i)
    if(!ethers.utils.isAddress(settings.owners[i])) errors.push(`Owner address invalid (${settings.owners[i]})`);
  if(!ethers.utils.isAddress(settings.to)) errors.push(`To address invalid (${settings.to})`);
  if(!ethers.utils.isAddress(settings.fallbackHandler)) errors.push(`Fallback Handler address invalid (${settings.fallbackHandler})`);
  if(!ethers.utils.isAddress(settings.paymentToken)) errors.push(`Payment Token address invalid (${settings.paymentToken})`);
  if(!ethers.utils.isAddress(settings.paymentReceiver)) errors.push(`Payment Receiver address invalid (${settings.paymentReceiver})`);
  if(settings.threshold <= 0) errors.push(`Threshold invalid (${settings.threshold})`);
  if(settings.threshold > settings.owners.length) errors.push(`Threshold invalid for number of owners (${settings.threshold}/${settings.owners.length})`);
  if(errors.length > 0) throw(errors.join("\n"));
}

// create ethers provider for each network
async function setupProviders() {
  const errors = [];
  if(settings.networks.length === 0) errors.push("No networks");
  for(let i = 0; i < settings.networks.length; ++i) {
    const network = settings.networks[i];
    // fix missing values
    network.chainID = network.chainID || "unknown";
    network.name = network.name || "unknown";
    network.confirmations = network.confirmations || 0;
    network.overrides = network.overrides || {};
    // create provider
    if(!network.url || network.url.length == 0) {
      errors.push(`URL not provided for network ${network.name}`);
      continue;
    }
    network.provider = new ethers.providers.JsonRpcProvider(network.url);
    network.deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, network.provider);
    // verify connection
    try {
      await network.provider.getBlockNumber();
    } catch(e) {
      errors.push(`Could not connect to network ${network.name}\n${e.toString()}`);
    }
  }
  if(errors.length > 0) throw(errors.join("\n"));
}

// verify factory and singleton are deployed on each network
async function verifyDeployments() {
  const promises = [];
  for(let i = 0; i < settings.networks.length; ++i) {
    const network = settings.networks[i];
    promises.push(isDeployed(network.provider, settings.factoryAddress));
    promises.push(isDeployed(network.provider, settings.singletonAddress));
  }
  const results = await Promise.all(promises);
  const errors = [];
  for(let i = 0; i < settings.networks.length; ++i) {
    if(!results[i*2]) errors.push(`Factory not detected at ${settings.factoryAddress} on chain ${settings.networks[i].name}`);
    if(!results[i*2+1]) errors.push(`Singleton not detected at ${settings.factoryAddress} on chain ${settings.networks[i].name}`);
  }
  if(errors.length > 0) throw(errors.join("\n"));
}

// make sure checkpoints folder exists
function checkFilesystem() {
  if(!fs.existsSync("./data/checkpoints/")) fs.mkdirSync("./data/checkpoints/");
  if(!fs.existsSync("./data/checkpoints/.gitignore")) fs.writeFileSync("./data/checkpoints/.gitignore", "*");
}

// get a list of safes to deploy
async function getSafes() {
  let safes = tryLoadSafesFromCheckpoint();
  if(safes.length >= settings.numToFind) {
    console.log(`Already found ${safes.length}/${settings.numToFind} safes. Skipping search`);
  } else {
    if(safes.length === 0) console.log(`Searching for ${settings.numToFind} safes`);
    else console.log(`Already found ${safes.length} safes. Searching for a total of ${settings.numToFind} safes`);
    safes = await searchForSafes(safes);
  }
  return safes;
}

// safely read known safes from checkpoint if available
function tryLoadSafesFromCheckpoint() {
  let safes = [];
  const checkpointFileName = `./data/checkpoints/${settings.checkpointFile}`;
  try {
    safes = JSON.parse(fs.readFileSync(checkpointFileName).toString());
    if(!safes.length) return [];
  } catch(e) {}
  return safes;
}

// find safes to deploy
async function searchForSafes(safes) {
  // safes = set of safes that are already known, find more
  // make sure we're not trying duplicate salts
  let saltNonce = BN.from(settings.startSaltNonce);
  for(let i = 0; i < safes.length; ++i) {
    const sn = BN.from(safes[i].saltNonce);
    if(sn.gte(saltNonce)) {
      saltNonce = sn.add(1);
    }
  }
  // construct initializer
  const initializer = await constructInitializer();
  // 0xff ++ deployingAddress is fixed:
  const string1 = "0xff".concat(settings.factoryAddress.substring(2));
  // get the proxy initCode
  const initCode = fs.readFileSync("./data/proxyInitCode.txt").toString().trim();
  // abi encode the singleton address
  const singletonAddressAbiEncoded = BN.from(settings.singletonAddress).toHexString().substring(2).padStart(64, "0");
  // add arguments to initCode
  const initCodeWithArgs = `${initCode}${singletonAddressAbiEncoded}`;
  // hash the initCode
  const string2 = ethers.utils.keccak256(Buffer.from(initCodeWithArgs.substring(2), "hex")).toString("hex").substring(2);
  // hash the initializer
  const initializerHash = ethers.utils.keccak256(initializer);
  // loop over salts until found number to find
  for(; (safes.length < settings.numToFind) && saltNonce.lt(ethers.constants.MaxUint256); saltNonce = saltNonce.add(1)) {
    // get salt from saltNonce
    const saltNonceAbiEncoded = saltNonce.toHexString().substring(2).padStart(64, "0");
    const salt = ethers.utils.keccak256(`${initializerHash}${saltNonceAbiEncoded}`);
    // convert salt to hex and it pad to 32 bytes
    const saltAbiEncoded = salt.toString(16).substring(2).padStart(64, "0");
    // concatenate this between the other 2 strings
    const concatString = string1.concat(saltAbiEncoded).concat(string2).toLowerCase();
    // hash the resulting string
    const hashed = ethersUtils.bufferToHex(ethers.utils.keccak256(Buffer.from(concatString.substring(2), "hex")));
    // remove leading 0x and 12 bytes to get address
    const addr = `0x${hashed.substr(26)}`;
    // display progress
    if(saltNonce.mod(1000000).isZero()) {
      console.log(`${saltNonce.toNumber()} -> ${addr}`);
      await sleeper(1000); // reduces hashrate but may allow background processes to run
    }
    // check vanity
    if(settings.isAcceptableVanity(addr)) {
      const safe = {
        safeAddress: ethers.utils.getAddress(addr),
        initializer: initializer,
        saltNonce: saltNonce.toString(),
        factoryAddress: settings.factoryAddress,
        singletonAddress: settings.singletonAddress,
        owners: settings.owners,
        threshold: settings.threshold,
        to: settings.to,
        data: settings.data,
        fallbackHandler: settings.fallbackHandler,
        paymentToken: settings.paymentToken,
        payment: settings.payment,
        paymentReceiver: settings.paymentReceiver
      }
      console.log("found safe");
      console.log(safe);
      safes.push(safe);
      const checkpointFileName = `./data/checkpoints/${settings.checkpointFile}`;
      fs.writeFileSync(checkpointFileName, JSON.stringify(safes, undefined, 2));
    }
  }
  return safes;
}

// constructs the initializer from new safe settings
async function constructInitializer() {
  let initializer = "";
  const dummyPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // account 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  const dummyUser = new ethers.Wallet(dummyPrivateKey, settings.networks[0].provider);
  const singleton = new ethers.Contract(settings.singletonAddress, singletonAbi, dummyUser);
  // pull the data from a failed tx
  // TODO: theres better ways to do this. this works though
  try {
    await singleton.connect(dummyUser).setup(settings.owners, settings.threshold, settings.to, settings.data, settings.fallbackHandler, settings.paymentToken, settings.payment, settings.paymentReceiver, {gasLimit: 21000});
  } catch(e) {
    if(!e.transaction || !e.transaction.data) {
      console.error("Could not construct initializer");
      throw(e);
    }
    initializer = e.transaction.data;
  }
  return initializer;
}

// deploy safes on all networks
async function deploySafes(safes) {
  console.log(`Deploying using EOA ${await settings.networks[0].deployer.getAddress()}`);
  // loop over all safes to deploy
  for(let i = 0; i < safes.length; ++i) {
    const safe = safes[i];
    // loop over all networks
    for(let j = 0; j < settings.networks.length; ++j) {
      const network = settings.networks[j];
      // short circuit if safe is already deployed
      if(await isDeployed(network.provider, safe.safeAddress)) {
        console.log(`Safe ${safe.safeAddress} is already deployed on network ${network.name}, skipping`);
        continue;
      }
      // deploy
      console.log(`Deploying safe ${safe.safeAddress} on network ${network.name}`);
      const factory = new ethers.Contract(safe.factoryAddress, factoryAbi, network.deployer);
      const tx = await factory.createProxyWithNonce(safe.singletonAddress, safe.initializer, safe.saltNonce, network.overrides);
      await tx.wait(network.confirmations);
      if(await isDeployed(network.provider, safe.safeAddress)) {
        console.log("Deployed successfully");
      } else {
        console.error("Warning: deployment transaction confirmed but safe not detected");
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
});
