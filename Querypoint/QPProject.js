// Google BSD license http://code.google.com/google_bsd_license.html
// Copyright 2011 Google Inc. johnjbarton@google.com

// A traceur RemoteWebPageProject that adds tracing to every compile

(function(){

  'use strict';

  var debug = DebugLogger.register('QPProject', function(flag){
    return debug = (typeof flag === 'boolean') ? flag : debug;
  });

  var RemoteWebPageProject = Querypoint.RemoteWebPageProject;

  function QPProject(url, loads) {
    RemoteWebPageProject.call(this, url);

    this.numberOfReloads = loads; 

    // FIXME override parent __getter__ for reporter
    this.reporter_ = new QPErrorReporter();

    this.compiler_ = new QPCompiler(this.reporter, {}); // TODO traceur options
        
    this.querypoints = Querypoint.Querypoints.initialize();
    
    this.runtime = Querypoint.QPRuntime.initialize();

    this._onWebPageNavigated = this._onWebPageNavigated.bind(this);
    this._monitorReloads();
    
    if (debug) console.log(loads + " QPProject created for "+url);
  }

  QPProject.prototype = {
    __proto__: RemoteWebPageProject.prototype,
        
    compile: function(onAllCompiled) {
      function onScriptsReady() {
        this.compiler_.compile(this);
        onAllCompiled(this.parseTrees_); 
      }
      this.addFilesFromScriptElements(this.remoteScripts, onScriptsReady.bind(this));
    },

    // Called by runInWebPage
    generateSourceFromTrees: function(treeObjectMap) {
      if (!treeObjectMap)
        return [];

      Querypoint.QPRuntime.initialize();

      return treeObjectMap.keys().map(function(file) {
        var tree = treeObjectMap.get(file);  

        this.querypoints.tracequeries.forEach(function(tq) {
          tree = tq.transformParseTree(tree);
          console.assert(tree);
        });

        var preambleTransformer = new Querypoint.QPFunctionPreambleTransformer(this.generateFileName);
        tree = preambleTransformer.transformAny(tree);

        file.generatedFileName = file.name + ".js";
        var writer = new QPTreeWriter(file.generatedFileName);
        file = writer.generateSource(file, tree);

        return file;
      }.bind(this));
    },

    startRuntime: function() {
      function startRuntime() {  // runs in web page
        try {
          window.__qp.fireLoad();
          return window.__qp_reloads;
        } catch(exc) {
          return exc.toString();
        }
      }
      function onRuntimeStarted(results, isException) {
        if (isException) {
          console.error("startRuntime FAILS");
        } else {
          if (debug) console.log("QP runtime called fireLoad() got "+results);
        }
      }
      chrome.devtools.inspectedWindow.eval(this.evalStringify(startRuntime, []), onRuntimeStarted);
    },

    runInWebPage: function(treeObjectMap) {
      // inject the tracing source
      RemoteWebPageProject.prototype.runInWebPage.call(this, treeObjectMap);
      this.startRuntime();
    },

    isGeneratedFile: function(name){
      return Object.keys(this.sourceFiles_).some(function(key) {
        return (this.sourceFiles_[key].generatedFileName === name);
      }.bind(this));
    },

    generateFileName: function (location) {
        return location ? location.start.source.name : "internal";
    },

    treeFinder: function() {
      return Querypoint.FindInTree;
    },

    getTreeByName: function(name) {
      var sourceFile = this.getFile(name);  
      if (sourceFile)
        return this.getParseTree(sourceFile);
    },

    find: function(name, offset) {
      var tree = this.getTreeByName(name);
      if (tree)
        return this.treeFinder().byOffset(tree, offset);
    },

    addScript: function(url) {
      if (debug) console.log("QPProject got new script " + url);
    },

    reload: function() {    
      this.querypoints.tracequeries.forEach(function(tq) {
        Querypoint.QPRuntime.appendSource(tq.runtimeSource());
      });
      
      this._unmonitorReloads();
      var onNavigated = function(url) {
        chrome.devtools.network.onNavigated.removeListener(onNavigated);
        if (url !== this.url) {
          console.error("QPProject reload failed: url mismatch: " + url + '!==' + this.url);
        }
        this.runInWebPage(this.parseTrees_);
        this._monitorReloads();        
      }.bind(this);
          
      chrome.devtools.network.onNavigated.addListener(onNavigated);
      
      this._reload(++this.numberOfReloads);
      
      return this.numberOfReloads;
    },
    
    _reload: function(numberOfReloads) {
      console.assert(typeof numberOfReloads === 'number');
      // We write a line that is parsed by Log.js calling back at this.addScript()
      function transcode(str, name ) {
        if (name && name.indexOf('.js.js') === -1)
          return  "console.log('qp| script " + name + "');";
        else
          return str; // evals, esp. our own evals!
      }

      var reloadOptions = {
        ignoreCache: true, 
        injectedScript:  Querypoint.QPRuntime.runtimeSource(numberOfReloads), 
        preprocessingScript: '(' + transcode + ')'
      };
      if (debug) console.log("reloadOptions.preprocessingScript ", reloadOptions.preprocessingScript);
      chrome.devtools.inspectedWindow.reload(reloadOptions);
    },
    
    _onWebPageNavigated: function(url) {
      if (url === this.url) {
        // a new project will be created by QuerypointDevtools.js
        return;
      } else {
        // User reloaded the page, so we are back to square one. TODO: offer to clear querypoints
        this.getPageScripts(function() {
          if (debug) console.log("rescanned page for scripts");
        });
      }
    },
    
    _monitorReloads: function() {
      chrome.devtools.network.onNavigated.addListener(this._onWebPageNavigated);
    },
    
    _unmonitorReloads: function() {
      chrome.devtools.network.onNavigated.addListener(this._onWebPageNavigated);
    },

    // These functions hide features depending on traceur and running in this window from
    // functions running in the UI window (Panel)
    lineModelTraceVisitor: function(sourceFile) {
      return new Querypoint.LineModelTraceVisitor(this, sourceFile);
    },
    treeHangerTraceVisitor: function() {
      return new Querypoint.TreeHangerTraceVisitor(this);
    }
    
  };

  window.Querypoint = window.Querypoint || {};
  window.Querypoint.QPProject = QPProject;

}());
