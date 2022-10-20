// a collection of utility functions

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// returns true if code is deployed at the given address and block
// returns false if the address is invalid or no code was deployed yet
async function isDeployed(provider, address, blockTag="latest") {
  try {
    // safety checks
    if(address === undefined || address === null) return false;
    if(address.length !== 42) return false;
    if(address == ZERO_ADDRESS) return false;
    if((await provider.getCode(address, blockTag)).length <= 2) return false;
    return true;
  } catch (e) {
    if(e.toString().includes('account aurora does not exist while viewing')) return false; // handle aurora idiosyncracies
    else throw e;
  }
}
exports.isDeployed = isDeployed;

// does nothing for an amount of time in milliseconds
async function sleeper(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
exports.sleeper = sleeper;
