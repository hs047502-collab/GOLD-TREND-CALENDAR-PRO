
/* =====================================================================
   LICENSE SERVER CONFIG — filled in by the build script (../build.mjs)
   These two values are PUBLIC ON PURPOSE:
     LICENSE_ENDPOINT — where keys are verified
     TOKEN_SECRET     — signs the offline grace token (see README: this is
                        not a key-minting secret and cannot create a license)
   The secret that mints keys (LICENSE_SECRET) exists ONLY on the server.
   ===================================================================== */
const LICENSE_ENDPOINT = '__LICENSE_ENDPOINT__';
const TOKEN_SECRET     = '__TOKEN_SECRET__';
