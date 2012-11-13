// Copyright 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

(function() {
  window.Querypoint = window.Querypoint || {};

  'use strict';

  var FreeVariableChecker = traceur.semantics.FreeVariableChecker;
  var IdentifierToken = traceur.syntax.IdentifierToken;
  var IdentifierExpression = traceur.syntax.trees.IdentifierExpression;
  var BindingIdentifier = traceur.syntax.trees.BindingIdentifier;
  var PredefinedName = traceur.syntax.PredefinedName;

  /**
   * Attachs a scope to each variable declaration tree
   *
   * This is run after all transformations to simplify the analysis. In
   * particular we can ignore:
   *   - module imports
   *   - block scope (let/const)
   *   - for of
   *   - generators
   *   - destructuring/rest
   *   - classes
   * as all of these nodes will have been replaced. We assume that synthetic
   * variables (generated by Traceur) will bind correctly, so we don't worry
   * about binding them as well as user defined variables.
   *
   * @param {ErrorReporter} reporter
   * @extends {ParseTreeVisitor}
   * @constructor
   */
  Querypoint.ScopeAttacher = function(reporter) {
    FreeVariableChecker.call(this, reporter);
  }

  /**
   * Gets the name of an identifier expression or token
   * @param {BindingIdentifier|IdentifierToken|string} name
   * @returns {string}
   */
  function getVariableName(name) {
    if (name instanceof IdentifierExpression) {
      name = name.identifierToken;
    } else if (name instanceof BindingIdentifier) {
      name = name.identifierToken;
    }
    if (name instanceof IdentifierToken) {
      name = name.value;
    }
    return name;
  }

  /**
   * Build scopes and attach them to variables in the tree.
   * 
   * @param {ErrorReporter} reporter
   * @param {Program} tree
   */
  Querypoint.ScopeAttacher.attachScopes = function(reporter, tree, global) {
    new Querypoint.ScopeAttacher(reporter).visitProgram(tree, global);
  }

  function Scope(parent, tree) {
    this.parent = parent;
    this.children = [];
    if (parent) 
      parent.children.push(this);
    this.tree = tree;
    this.references = Object.create(null);
    this.declarations = Object.create(null);
  }


  Querypoint.ScopeAttacher.prototype = {
    __proto__: FreeVariableChecker.prototype,

    declareVariable_: function(tree) {
      var name = getVariableName(tree);
      if (name) {
        var scope = this.scope_;
        if (!(name in scope.declarations)) {
          scope.declarations[name] = tree;
          tree.scope = scope;
        }
      }
    },

    pushScope_: function(tree) {
      return this.scope_ = new Scope(this.scope_, tree);
    },

    visitIdentifierExpression: function(tree) {
      var name = getVariableName(tree);
      var scope = this.scope_;
      while (scope) {
        if (Object.hasOwnProperty.call(scope.declarations,name)) {
          var decl = scope.declarations[name];
          if (typeof decl === 'object') {
            decl.references = decl.references || [];
            decl.references.push(tree);
            tree.declaration = decl;
          } // else built-in
          break;
        }
        scope = scope.parent;
      }
    },

    visitProgram: function(tree, global) {
      var scope = this.pushScope_(tree);

      // Declare variables from the global scope.
      // TODO(jmesserly): this should be done through the module loaders, and by
      // providing the user the option to import URLs like '@dom', but for now
      // just bind against everything in the global scope.
      var object = global;
      while (object) {
        Object.getOwnPropertyNames(object).forEach(this.declareVariable_, this);
        object = Object.getPrototypeOf(object);
      }

      this.visitStatements_(tree.programElements);

      this.pop_(scope);
    },

    visitFunction_: function(name, formalParameterList, body) {
      // Declare the function name, 'arguments' and formal parameters inside the
      // function
      if (name)
        this.declareVariable_(name);
      this.declareVariable_(PredefinedName.ARGUMENTS);
      this.visitAny(formalParameterList);

      this.visitAny(body);
    },

    visitFunctionDeclaration: function(tree) {
      var scope = this.pushScope_(tree);
      this.visitFunction_(tree.name, tree.formalParameterList,
                          tree.functionBody);
      this.pop_(scope);
    },

    visitArrowFunctionExpression: function(tree) {
      var scope = this.pushScope_(tree);
      this.visitFunction_(null, tree.formalParameters, tree.functionBody);
      this.pop_(scope);
    },

    visitGetAccessor: function(tree) {
      var scope = this.pushScope_(tree);

      this.visitAny(tree.body);

      this.pop_(scope);
    },

    visitSetAccessor: function(tree) {
      var scope = this.pushScope_(tree);

      this.declareVariable_(tree.parameter.binding);
      this.visitAny(tree.body);

      this.pop_(scope);
    },

    visitCatch: function(tree) {
      var scope = this.pushScope_(tree);

      this.visitAny(tree.binding);
      this.visitAny(tree.catchBody);

      this.pop_(scope);
    },


  };

  return {
    ScopeAttacher: Querypoint.ScopeAttacher
  };
}());
