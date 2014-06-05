/*
 * grunt-release
 * https://github.com/geddski/grunt-release
 *
 * Copyright (c) 2013 Dave Geddes
 * Licensed under the MIT license.
 */

var shell = require('shelljs');
var semver = require('semver');
var request = require('superagent');
var Q = require('q');

module.exports = function(grunt){
  grunt.registerTask('release', 'bump version, git tag, git push, npm publish', function(type){
    
    //defaults
    var options = this.options({
      bump: true,
      file: grunt.config('pkgFile') || 'package.json',
      bumpShrinkwrap: false,
      add: true,
      commit: true,
      tag: true,
      push: true,
      pushTags: true,
      npm : true
    });

    var config = setup(options.file, type);
    var templateOptions = {
      data: {
        version: config.newVersion
      }
    };
    var tagName = grunt.template.process(grunt.config.getRaw('release.options.tagName') || '<%= version %>', templateOptions);
    var commitMessage = grunt.template.process(grunt.config.getRaw('release.options.commitMessage') || 'release <%= version %>', templateOptions);
    var tagMessage = grunt.template.process(grunt.config.getRaw('release.options.tagMessage') || 'version <%= version %>', templateOptions);
    var nowrite = grunt.option('no-write');
    var task = this;
    var done = this.async();

    if (nowrite){
      grunt.log.ok('-------RELEASE DRY RUN-------');
    }

    Q()
      .then(ifEnabled('bump', bump))
      .then(ifEnabled('add', add))
      .then(ifEnabled('commit', commit))
      .then(ifEnabled('tag', tag))
      .then(ifEnabled('push', push))
      .then(ifEnabled('pushTags', pushTags))
      .then(ifEnabled('npm', publish))
      .then(ifEnabled('github', githubRelease))
      .catch(function(msg){
        grunt.fail.warn(msg || 'release failed')
      })
      .finally(done);


    function setup(file, type){
      var pkg = grunt.file.readJSON(file);
      var newVersion = pkg.version;
      if (options.bump) {
        newVersion = semver.inc(pkg.version, type || 'patch');
      }
      if (options.bumpShrinkwrap) {
        var shrinkwrap = grunt.file.readJSON('npm-shrinkwrap.json');
      }
      return {file: file, pkg: pkg, shrinkwrap: shrinkwrap, newVersion: newVersion};
    }

    function getNpmTag(){
      var tag = grunt.option('npmtag') || options.npmtag;
      if(tag === true) { tag = config.newVersion }
      return tag;
    }

    function ifEnabled(option, fn){
      if (options[option]) return fn;
    }

    function run(cmd, msg){
      var deferred = Q.defer();
      grunt.verbose.writeln('Running: ' + cmd);

      if (nowrite) {
        grunt.log.ok(msg || cmd);
        deferred.resolve();
      }
      else {
        var success = shell.exec(cmd, {silent:true}).code === 0;

        if (success){ 
          grunt.log.ok(msg || cmd);
          deferred.resolve();
        }
        else{
          // fail and stop execution of further tasks
          deferred.reject('Failed when executing: `' + cmd + '`\n');
        }
      }
      return deferred.promise;
    }

    function add(){
      var files = [config.file];
      if (options.bumpShrinkwrap) { files.push('npm-shrinkwrap.json') };
      return run('git add ' + files.join(' '), ' staged ' + files.join(', '));
    }

    function commit(){
      var files = [config.file];
      if (options.bumpShrinkwrap) { files.push('npm-shrinkwrap.json') };
      return run('git commit '+ files.join(' ') +' -m "'+ commitMessage +'"', 'committed ' + files.join(', '));
    }

    function tag(){
      return run('git tag ' + tagName + ' -m "'+ tagMessage +'"', 'created new git tag: ' + tagName);
    }

    function push(){
      return run('git push', 'pushed to remote git repo');
    }

    function pushTags(){
      return run('git push --tags', 'pushed new tag '+ config.newVersion +' to remote git repo');
    }

    function publish(){
      var cmd = 'npm publish';
      var msg = 'published version '+ config.newVersion +' to npm';
      var npmtag = getNpmTag();
      if (npmtag){ 
        cmd += ' --tag ' + npmtag;
        msg += ' with a tag of "' + npmtag + '"';
      }
      if (options.folder){ cmd += ' ' + options.folder }
      return run(cmd, msg);
    }


    function bump(){
      return Q.fcall(function () {
        config.pkg.version = config.newVersion;
        grunt.file.write(config.file, JSON.stringify(config.pkg, null, '  ') + '\n');

        if (options.bumpShrinkwrap) {
          config.shrinkwrap.version = config.newVersion;
          grunt.file.write('npm-shrinkwrap.json', JSON.stringify(config.shrinkwrap, null, '  ') + '\n');
        }

        grunt.log.ok('bumped version to ' + config.newVersion);
      });
    }

    function githubRelease(){
      var deferred = Q.defer();
      if (nowrite){ 
        success();
        return;
      }

      request
        .post('https://api.github.com/repos/' + options.github.repo + '/releases')
        .auth(process.env[options.github.usernameVar], process.env[options.github.passwordVar])
        .set('Accept', 'application/vnd.github.manifold-preview')
        .set('User-Agent', 'grunt-release')
        .send({"tag_name": tagName, "name": tagMessage})
        .end(function(res){
          if (res.statusCode === 201){
            success();
          } 
          else {
            deferred.reject('Error creating github release. Response: ' + res.text);
          }
        });

      function success(){
        grunt.log.ok('created ' + tagName + ' release on github.');
        deferred.resolve();
      }

      return deferred.promise;
    }

  });
};
