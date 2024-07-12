// @ts-check
// Do not run this file directly. Run it via `npm run watch`. See package.json for more info.
const { spawn, exit } = require('child_process');
const fs = require('fs');

/**
 * 
 * @param {string} program 
 * @param {string[]} args 
 * @returns {ReturnType<typeof spawn>}
 */
function cmd(program, args = []) {
    const spawnOptions = { "shell": true };
    console.log('CMD:', program, args.flat(), spawnOptions);
    const p = spawn(program, args.flat(), spawnOptions); // NOTE: flattening the args array enables you to group related arguments for better self-documentation of the running command
    // @ts-ignore [stdout may be null?]
    p.stdout.on('data', (data) => process.stdout.write(data));
    // @ts-ignore [stderr may be null?]
    p.stderr.on('data', (data) => process.stderr.write(data));
    p.on('close', (code) => {
        if (code !== 0) {
            console.error(program, args, 'exited with', code);
        }
    });
    return p;
}

const SERVER_FILE_NAME = 'server.mjs';

function start() {
    cmd('tsc', ['-w'])
    // TODO: restart the websocket server when server.mjs is modified
    cmd('node', [SERVER_FILE_NAME])
    cmd('http-server', ['-p', '6969', '-a', '127.0.0.1', '-s', '-c-1', '-d', 'false'])
}

fs.stat(SERVER_FILE_NAME, (err, stat) => {
    if (err === null) {
        start();
    } else if (err.code === 'ENOENT') {
        cmd('tsc').on('exit', start);
    } else {
        throw new Error(`Something went wrong while checking existance of ${SERVER_FILE_NAME}: ${err.code}`);
    }
})
