// --- Configuration ---
// Replace with the ACTUAL npub of the recipient you want to send DMs to.
const RECIPIENT_NPUB = "npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424"; // <<<--- IMPORTANT: SET YOUR RECIPIENT NPUB HERE

// List of relays to publish the message to. Choose reliable public ones.
const RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.nostr.band',
];
// --- End Configuration ---

const contactForm = document.getElementById('contactForm');
const submitButton = document.getElementById('submitButton');
const statusDiv = document.getElementById('status');

// Ensure nostr-tools is loaded
if (typeof window.NostrTools === 'undefined') {
    setStatus('Error: nostr-tools library not loaded.', 'error');
    if (submitButton) submitButton.disabled = true;
}

contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!window.NostrTools) {
        setStatus('Error: nostr-tools library not available.', 'error');
        return;
    }

    const { nip19, generatePrivateKey, getPublicKey, nip04, SimplePool, signEvent, getEventHash } = window.NostrTools;

    if (typeof SimplePool !== 'function' || typeof signEvent !== 'function' || typeof getEventHash !== 'function') {
        setStatus('Error: Required functions (SimplePool, signEvent, getEventHash) not found in nostr-tools.', 'error');
        return;
    }

    setStatus('Processing...', 'info');
    submitButton.disabled = true;

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const nostrAddress = document.getElementById('nostr_address').value.trim();
    const message = document.getElementById('message').value.trim();

    if (!name || !email || !message) {
        setStatus('Please fill in all required fields.', 'error');
        submitButton.disabled = false;
        return;
    }

    // --- 1. Decode Recipient npub ---
    let recipientHexPubKey;
    try {
        const decoded = nip19.decode(RECIPIENT_NPUB);
        if (decoded.type !== 'npub') {
            throw new Error('Invalid recipient npub format.');
        }
        recipientHexPubKey = decoded.data;
    } catch (e) {
        console.error("Error decoding recipient npub:", e);
        setStatus(`Error: Invalid recipient Nostr address (npub): ${RECIPIENT_NPUB}. ${e.message}`, 'error');
        submitButton.disabled = false;
        return;
    }

    // --- Main processing block ---
    let pool;
    try {
        // --- 2. Generate Ephemeral Sender Keypair ---
        const senderSk = generatePrivateKey();
        const senderPk = getPublicKey(senderSk);
        console.log("Generated ephemeral sender pubkey:", senderPk);

        // --- 3. Format the Message Content ---
        const messageContent = `Contact Form Submission:
-------------------------
Name: ${name}
Email: ${email}
${nostrAddress ? `Nostr Address: ${nostrAddress}\n` : ''}-------------------------
Message:
${message}`;

        // --- 4. Encrypt the Message (NIP-04) ---
        const encryptedMessage = await nip04.encrypt(senderSk, recipientHexPubKey, messageContent);

        // --- 5. Create Base Nostr Event (Kind 4 - DM) ---
        let event = { // Use 'event' as the object name
            kind: 4,
            pubkey: senderPk,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['p', recipientHexPubKey]
            ],
            content: encryptedMessage,
            // id and sig will be added below
        };

        // --- 6. Calculate ID and Sign the Event ---
        // Add the ID
        event.id = getEventHash(event);

        // Call signEvent and ASSUME it returns ONLY the signature string
        const signature = await signEvent(event, senderSk);

        // Explicitly add the returned signature to the event object
        if (typeof signature === 'string' && signature.length === 128) { // Basic check for hex signature
             event.sig = signature;
             console.log("Assumed signEvent returned signature string, added it to event.");
        } else {
             // If it didn't return a valid-looking signature string, something is wrong.
             console.error("signEvent did not return the expected signature string. Result:", signature);
             throw new Error("Failed to obtain a valid signature string from signEvent.");
        }

        // --- Verification --- Check the event object NOW
        console.log("Final Event Object to Publish:", event);
        if (!event.id || !event.sig) {
             // If we reach here, the logic above failed somehow
             throw new Error("Internal error: Event object still missing id or sig after manual assignment.");
        }

        // --- 7. Publish to Relays using SimplePool ---
        setStatus('Connecting to relays and sending...', 'info');
        pool = new SimplePool();

        let publishPromises = pool.publish(RELAYS, event); // Publish the final 'event' object

        let results = await Promise.allSettled(publishPromises);

        let successes = 0;
        let failures = [];
        let failureReasons = [];

        results.forEach((result, index) => {
            const relayUrl = RELAYS[index];
            if (result.status === 'fulfilled') {
                console.log(`Sent event command to ${relayUrl}. Status: ${result.status}`);
                successes++;
            } else {
                const reason = result.reason instanceof Error ? result.reason.message : JSON.stringify(result.reason);
                console.error(`Failed to send event command to ${relayUrl}:`, reason);
                failures.push(relayUrl);
                failureReasons.push(`${relayUrl}: ${reason}`);
            }
        });

        if (successes > 0) {
            setStatus(`Message sent via Nostr (attempted on ${successes}/${RELAYS.length} relays).`, 'success');
            contactForm.reset();
        } else {
            throw new Error(`Failed to send message to any relays. Reasons: ${failureReasons.join('; ')}`);
        }

    } catch (error) {
        console.error("Error sending Nostr DM:", error);
        if (!statusDiv.textContent.includes('Invalid recipient')) {
             setStatus(`Error sending message: ${error.message}`, 'error');
        }
    } finally {
        if (pool) {
            try {
                 pool.close(RELAYS);
                 console.log("Relay connections closed.");
            } catch (closeError) {
                 console.error("Error closing relay pool connections:", closeError);
            }
        }
        submitButton.disabled = false;
    }
});

function setStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = type;
    console.log(`Status [${type}]: ${message}`);
}
