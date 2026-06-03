const StellarSdk = require('@stellar/stellar-sdk');

function generateAccount(userContext, events, done) {
  // Generate a random keypair for each virtual user
  const keypair = StellarSdk.Keypair.random();
  userContext.vars.account = keypair.publicKey();
  userContext.vars.secret = keypair.secret();
  return done();
}

module.exports = {
  generateAccount,
};
