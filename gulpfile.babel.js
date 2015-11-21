import assign from 'object-assign';
import autoprefixer from 'gulp-autoprefixer';
import bower from 'bower';
import changed from 'gulp-changed';
import connect from 'gulp-connect';
import del from 'del';
import engineIoClient from 'engine.io-client';
import engineIo from 'engine.io';
import { exec } from 'child_process';
import gulp from 'gulp';
import gutil from 'gulp-util';
import karma from 'karma';
import minimist from 'minimist';
import plumber from 'gulp-plumber';
import rename from 'gulp-rename';
import runSequence from 'run-sequence';
import sass from 'gulp-sass';
import size from 'gulp-size';
import sourcemaps from 'gulp-sourcemaps';
import tslint from 'gulp-tslint';
import tsd from 'tsd';
import ts from 'gulp-typescript';
import watch from 'gulp-watch';

import { SAUCE_LAUNCHERS, SAUCE_ALIASES } from './sauce.config';


const GULP_SIZE_DEFAULT_OPTS = {
	showFiles: true,
	gzip: true
};

const KARMA_CONFIG = {
	configFile: `${__dirname}/karma.config.js`
};

const ENGINE_IO_BASE_SOCKET_ADDRESS = 'ws://localhost:';

const LAB_JS_BUILD_SERVER_PORT = 6174; // Kaprekar's constant
const LAB_JS_BUILD_SERVER_ADDRESS = `${ENGINE_IO_BASE_SOCKET_ADDRESS}${LAB_JS_BUILD_SERVER_PORT}`;

const LAB_BUILD_SERVER_PORT = 1729; // Hardy–Ramanujan number
const LAB_BUILD_SERVER_ADDRESS = `${ENGINE_IO_BASE_SOCKET_ADDRESS}${LAB_BUILD_SERVER_PORT}`;

const LAB_WEB_SERVER_PORT = 3000;

const PATHS = {
	lib: [
		'bower_components/firebase/firebase.js',
		'node_modules/es6-shim/es6-shim.*',
		'node_modules/systemjs/dist/system.*',
		'node_modules/angular2/bundles/angular2.*',
		'node_modules/angular2/bundles/router.*',
		'node_modules/angular2/bundles/http.*',
		'node_modules/angular2/bundles/testing.*'
	],
	typings: [
		'src/_typings/custom.d.ts',
		'tsd_typings/tsd.d.ts'
	],
	src: {
		root: './src',
		static: 'src/**/*.{svg,jpg,png,ico}',
		ts: [
			'!src/_typings/*.d.ts',
			'src/**/*.ts'
		],
		html: 'src/**/*.html',
		scss: [
			'!src/app/vars.scss',
			'!src/app/mixins.scss',
			'src/**/*.scss'
		],
		spec: [
			'src/**/*.spec.ts'
		]
	},
	dist: 'dist'
};

const NG2_LAB_TS_PROJECT = ts.createProject('tsconfig.json');


// Clean
gulp.task('clean', (done) => {
	del([PATHS.dist]).then(() => {
		done();
	});
});


// Dependecies

gulp.task('bower/install', (done) => {
	bower
		.commands
		.install(null, { save: true }, { interactive: false })
		.on('error', console.error.bind(console))
		.on('end', () => {
			done();
		});
});

gulp.task('tsd/install', () => {
	let config = './tsd.json';
	let api = tsd.getAPI(config);
	return api.readConfig(config, true).then(() => {
		let opts = tsd.Options.fromJSON(); // https://github.com/DefinitelyTyped/tsd/blob/bb2dc91ad64f159298657805154259f9e68ea8a6/src/tsd/Options.ts
		let query = new tsd.Query();
		opts.saveBundle = true;
		opts.overwriteFiles = true;
		opts.resolveDependencies = true;
		api.context.config.getInstalled().forEach((install) => {
			let def = tsd.Def.getFrom(install.path);
			query.addNamePattern(`${def.project}/${def.name}`);
		});
		query.versionMatcher = new tsd.VersionMatcher('latest');
		return api.select(query, opts).then((selection) => {
			return api.install(selection, opts);
		});
		return api.reinstall(opts);
	});
});

gulp.task('deps', ['bower/install', 'tsd/install'], () => {
	const LIBS_PATH = `${PATHS.dist}/lib`;
	return gulp
		.src(PATHS.lib)
		.pipe(changed(LIBS_PATH))
		.pipe(rename((file) => {
			file.basename = file.basename.toLowerCase(); // Firebase is case sensitive, thus we lowercase all for ease of access
		}))
		.pipe(size(GULP_SIZE_DEFAULT_OPTS))
		.pipe(gulp.dest(LIBS_PATH));
});


// Build

let jsBuildServerSocket;
gulp.task('build/js', (done) => {
	if (jsBuildServerSocket) {
		let stream = buildJS();
		stream.on('end', () => {
			jsBuildServerSocket.send('build/js:done');
			done();
		});
	}
	else {
		isEngineIOServerRunning(LAB_JS_BUILD_SERVER_PORT).then(
			() => {
				jsBuildServerSocket = engineIoClient(LAB_JS_BUILD_SERVER_ADDRESS);
				jsBuildServerSocket.on('open', () => {
					let stream = buildJS();
					stream.on('end', () => {
						jsBuildServerSocket.send('build/js:done');
						done();
					});
				});
			},
			() => {
				let stream = buildJS();
				stream.on('end', () => {
					done();
				});
			}
		);
	}
});

gulp.task('serve/html', () => {
	return gulp
		.src(PATHS.src.html)
		.pipe(changed(PATHS.dist))
		.pipe(size(GULP_SIZE_DEFAULT_OPTS))
		.pipe(gulp.dest(PATHS.dist));
});

gulp.task('build/css', () => {
	let SASS_CONFIG = {
		includePaths: [
			`${PATHS.src.root}/app`
		],
		outputStyle: 'compressed', // nested (default), expanded, compact, compressed
		indentType: 'tab',
		indentWidth: 1,
		linefeed: 'lf'
	};
	return gulp
		.src(PATHS.src.scss)
		.pipe(changed(PATHS.dist, { extension: '.css' }))
		.pipe(plumber())
		.pipe(sourcemaps.init())
		.pipe(sass(SASS_CONFIG).on('error', sass.logError))
		.pipe(autoprefixer())
		.pipe(sourcemaps.write('.'))
		.pipe(size(GULP_SIZE_DEFAULT_OPTS))
		.pipe(gulp.dest(PATHS.dist));
});

gulp.task('serve/static', () => {
	return gulp
		.src(PATHS.src.static)
		.pipe(changed(PATHS.dist))
		.pipe(size(GULP_SIZE_DEFAULT_OPTS))
		.pipe(gulp.dest(PATHS.dist));
});

gulp.task('build', (done) => {
	runSequence(
		'deps',
		[
			'serve/static',
			'build/js',
			'serve/html',
			'build/css'
		],
		done
	);
});

// Build if lab build server is not running
gulp.task('build:!ilbsr', (done) => {
	isEngineIOServerRunning(LAB_BUILD_SERVER_PORT).then(() => { done(); }, () => {
		runSequence('build', done);
	});
}),


// Code integrity
gulp.task('lint', () => { // https://github.com/palantir/tslint#supported-rules
	return gulp
		.src(PATHS.src.ts)
		.pipe(plumber())
		.pipe(tslint())
		.pipe(tslint.report('verbose', {
			summarizeFailureOutput: true,
			emitError: true
		}));
});


// Tests

gulp.task('test/unit:ci', (done) => {
	let browserConf = getBrowsersConfigFromCLI();
	let config = assign({}, KARMA_CONFIG, {
		singleRun: true,
		reporters: [
			'dots'
		],
		browsers: browserConf.browsers
	});
	let server = new karma.Server(config, (err) => {
		done();
		process.exit(err ? 1 : 0);
	});
	server.start();
});

gulp.task('test/unit:single', ['build:!ilbsr'], (done) => { // Run unit tests once in local env
	let config = assign({}, KARMA_CONFIG, {
		singleRun: true
	});
	let server = new karma.Server(config, () => {
		done();
	});
	server.start();
});

gulp.task('test/unit:ci/sauce', (done) => {
	let config = assign({}, KARMA_CONFIG, {
		singleRun: true,
		browserNoActivityTimeout: 240000,
		captureTimeout: 120000,
		reporters: [
			'dots',
			'saucelabs'
		],
		browsers: SAUCE_ALIASES.CI
	});
	let server = new karma.Server(config, (err) => {
		done();
		process.exit(err ? 1 : 0);
	});
	server.start();
});

gulp.task('test/unit:sauce', ['build:!ilbsr'], (done) => {
	let browserConf = getBrowsersConfigFromCLI();
	let config = assign({}, KARMA_CONFIG, {
		singleRun: true,
		browserNoActivityTimeout: 240000,
		captureTimeout: 120000,
		reporters: [
			'dots'
		],
		browsers: browserConf.browsers
	});
	if (!browserConf.isSauce) {
		gutil.log(gutil.colors.red('There were no Saucelabs browsers provided, add them with the --browsers option'));
		done();
		process.exit(1);
	} else {
		let server = new karma.Server(config, (err) => {
			done();
			process.exit(err ? 1 : 0);
		});
		server.start();
	}
});

gulp.task('karma/server', () => {
	let server = new karma.Server(KARMA_CONFIG);
	server.start();
});

gulp.task('karma/run', (done) => {
	// run the run command in a new process to avoid duplicate logging by both server and runner from a single process
	runKarma('karma.config.js', done);
});

gulp.task('test/unit', ['build:!ilbsr'], (done) => {
	runSequence(
		'karma/server',
		() => {
			// Create a build server to avoid parallel js builds when running unit tests in another process
			// If the js build server is shut down from some other process (the same process that started it), restart it here
			createJsBuildServer(() => {
				createJsBuildServer();
			}).then(() => {
				let client = engineIoClient(LAB_JS_BUILD_SERVER_ADDRESS);
				client.on('open', () => {
					client.on('message', (msg) => {
						if (msg === 'build/js:done') runSequence('karma/run');
					});
				});
			});
		}
	);
});

gulp.task('test', (done) => {
	runSequence(
		'lint',
		'test/unit:single',
		done
	);
});


// Deployments

gulp.task('deploy/hosting', ['build:!ilbsr'], () => {
	return runFirebaseCommand('deploy:hosting');
});

gulp.task('deploy/hosting:ci', (done) => {
	runFirebaseCommand('deploy:hosting').then(
		() => done(),
		() => {
			done();
			process.exit(1);
		}
	);
});

gulp.task('deploy', (done) => {
	runSequence('deploy/hosting', done);
});


// Web server
gulp.task('server', (done) => {
	createWebServer();
});


// Lab
gulp.task('start', (done) => {
	isEngineIOServerRunning(LAB_BUILD_SERVER_PORT).then(
		() => {
			gutil.log(gutil.colors.red('A lab build server instance has already been started in another process, cannot start another one'));
			done();
			process.exit(1);
		},
		() => {
			runSequence('build', () => {
				// Create a build server to avoid parallel js builds when running unit tests in another process
				// If the js build server is shut down from some other process (the same process that started it), restart it here
				createJsBuildServer(() => {
					createJsBuildServer();
				});
				createBuildServer();
				createWebServer();
				gutil.log(gutil.colors.green('File watch processes for HTML, CSS & static assets started'));
				watch(PATHS.src.html, () => {
					runSequence('serve/html');
				});
				watch(PATHS.src.scss, () => {
					runSequence('build/css');
				});
				watch(PATHS.src.static, () => {
					runSequence('serve/static');
				});
			});
		}
	);
});


// Default task
gulp.task('default', [
	'start'
]);


// Catch SIGINT and call process.exit() explicitly on CTRL+C so that we actually get the exit event
process.on('SIGINT', () => {
	process.exit();
});


function createWebServer () {
	connect.server({
		port: LAB_WEB_SERVER_PORT,
		root: PATHS.dist
	});
}

// https://github.com/firebase/firebase-tools#commands
function runFirebaseCommand (cmd) {
	const binary = process.platform === 'win32' ? 'node_modules\\.bin\\firebase' : 'node node_modules/.bin/firebase';
	const argv = minimist(process.argv.slice(2));
	const TOKEN = process.env.FIREBASE_TOKEN || argv.token;
	if (!TOKEN) {
		gutil.log(gutil.colors.red('No FIREBASE_TOKEN found in env or --token option passed.'));
		return Promise.reject();
	}
	let args = [
		'--non-interactive',
		'--token',
		`"${TOKEN}"`
	];
	if (Array.isArray(cmd)) args.unshift.apply(args, cmd);
	else args.unshift(cmd);
	args.unshift(binary);
	return new Promise((resolve, reject) => {
		let proc = exec(args.join(' '), (error, stdout, stderr) => {
			if (error !== null) reject();
			resolve();
		});
		proc.stdout.on('data', (data) => {
			console.log(data);
		});
		proc.stderr.on('data', (data) => {
			console.log(data);
		});
	});
}

function runKarma (configFile, done) {
	let cmd = process.platform === 'win32' ? 'node_modules\\.bin\\karma run ' : 'node node_modules/.bin/karma run ';
	cmd += configFile;
	exec(cmd, (e, stdout) => {
		// ignore errors, we don't want to fail the build in the interactive (non-ci) mode
		// karma server will print all test failures
		done();
	});
}

function getBrowsersConfigFromCLI () {
	let isSauce = false;
	const args = minimist(process.argv.slice(2));
	let rawInput = args.browsers ? args.browsers : 'CHROME_TRAVIS_CI';
	let inputList = rawInput.replace(' ', '').split(',');
	let outputList = [];
	for (let i = 0; i < inputList.length; i++) {
		let input = inputList[i];
		if (SAUCE_LAUNCHERS.hasOwnProperty(input)) {
			// Non-sauce browsers case: overrides everything, ignoring other options
			outputList = [input];
			isSauce = false;
			break;
		} else if (SAUCE_LAUNCHERS.hasOwnProperty(`SL_${input.toUpperCase()}`)) {
			isSauce = true;
			outputList.push(`SL_${input.toUpperCase()}`);
		} else if (SAUCE_ALIASES.hasOwnProperty(input.toUpperCase())) {
			outputList = outputList.concat(SAUCE_ALIASES[input]);
			isSauce = true;
		} else throw new Error('ERROR: unknown browser found in getBrowsersConfigFromCLI()');
	}
	return {
		browsers: outputList.filter((item, pos, self) => {
			return self.indexOf(item) == pos;
		}),
		isSauce: isSauce
	}
}

function buildJS () {
	return gulp
		.src(PATHS.src.ts.slice(-1).concat(PATHS.typings), { base: PATHS.src.root }) // instead of gulp.src(...), project.src() can be used
		.pipe(changed(PATHS.dist, { extension: '.js' }))
		.pipe(plumber())
		.pipe(sourcemaps.init())
		.pipe(ts(NG2_LAB_TS_PROJECT))
		.js
		.pipe(sourcemaps.write('.'))
		.pipe(size(GULP_SIZE_DEFAULT_OPTS))
		.pipe(gulp.dest(PATHS.dist));
}

function createBuildServer () {
	let server = createEngineIOServer(LAB_BUILD_SERVER_PORT, () => {
		gutil.log(gutil.colors.green(`Lab build server started ${LAB_BUILD_SERVER_ADDRESS}`));
	});
	process.on('exit', () => {
		server.close();
	});
}

function createJsBuildServer (onShutdown) {
	return new Promise((resolve, reject) => {
		isEngineIOServerRunning(LAB_JS_BUILD_SERVER_PORT).then(
			() => {
				let client = engineIoClient(LAB_JS_BUILD_SERVER_ADDRESS);
				client.on('open', () => {
					client.on('close', (msg) => {
						if (typeof onShutdown === 'function') onShutdown();
					});
				});
				gutil.log(gutil.colors.yellow(`JS build server already running on ${LAB_JS_BUILD_SERVER_ADDRESS}`));
				resolve();
			},
			() => {
				let watcher = watch(PATHS.src.ts, () => {
					runSequence('build/js');
				});
				let server = createEngineIOServer(LAB_JS_BUILD_SERVER_PORT, () => {
					gutil.log(gutil.colors.green(`JS build server started ${LAB_JS_BUILD_SERVER_ADDRESS}`));
					resolve();
				});
				server.on('connection', (socket) => {
					socket.on('message', (msg) => {
						server.broadcast(msg, socket.id);
					});
				});
				process.on('exit', () => {
					watcher.close();
					server.close();
				});
			}
		);
	});
}

function createEngineIOServer (port, done) {
	let server = engineIo.listen(port, typeof done === 'function' ? done : noop);
	// Send message to everyone but (optionally) the sender
	server.broadcast = (msg, skipId) => {
		for (let id in server.clients) {
			if (typeof skipId !== 'undefined') {
				if (id == skipId) continue; // Don't broadcast to sender
			}
			server.clients[id].send(msg);
		}
	}
	return server;
}

function isEngineIOServerRunning (port, timeout) {
	return new Promise((resolve, reject) => {
		let client = engineIoClient(`${ENGINE_IO_BASE_SOCKET_ADDRESS}${port}`);
		let timer = setTimeout(() => {
			reject();
			client.close();
		}, timeout || 500);
		client.on('open', () => {
			clearTimeout(timer);
			resolve();
			client.close();
		});
		client.on('close', () => {
			clearTimeout(timer);
			reject();
		});
	});
}

function noop () {}