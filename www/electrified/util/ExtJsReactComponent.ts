import {Ext} from "../classicGlobalObjects";
import {callParent} from "./util";
import React from 'react';
import * as ReactDOM from "react-dom";
import {createRoot} from "react-dom/client";

Ext.namespace("electrified.util");

/**
 * Usage:
 *
 * <pre><code>
 * Ext.create(app.util.ui.ReactComponent,{
 *   	                		componentClass: MyReactComponent
 *   	                		props: {...reactProps},
 *   	                		...extJsProps
 *   	                	});
 * </code></pre>
 *
 * <p>
 * TODO: Allow to pass a component **function**, wrap in watchedcomponent, suspense, error-handler, theme providers.
 * </p>
 */
export const ReactComponent = Ext.define("electrified.util.ReactComponent", {
    extend: "Ext.Component",
    html: "reactcomponent", // must have some html
    config: {
        /**
         * Class / constructor function of the react component to render
         */
        componentClass: null,

        /**
         * Properties to pass to the component
         */
        props: {}
    },
    listeners: {
        afterrender: function(me: any, eOpts: any) {
            createRoot(me.getEl().dom).render(React.createElement(me.componentClass, me.props ), );
        }

    }
});


/**
 * A panel that holds a reactjs component
 */
export const ReactPanel = Ext.define("electrified.util.ReactPanel", {
    extend: "Ext.panel.Panel",
    layout: {
        type: "border"

    },
    config: {
        /**
         * Class / constructor function of the react component to render
         */
        componentClass: null,

        /**
         * Properties to pass to the component
         */
        props: {}
    },

    constructor: function(config: any) {
        // validity check:
        if(config.componentClass == null) {
            throw "componentClass not set";
        }

        config.items= [
            // Panel for the content. 2 levels, because when adding a component.box directly, the browsers behave buggy.
            // Also we can attach the toolbar and the searchMatchesPanel  there
            {
                xtype: "panel",
                region: "center",
                name: "centerPanel",
                border: false,
                layout: {
                    type: 'vbox',
                    align: 'stretch'
                },
                items: [
                    // Component that holds the content:
                    {
                        xtype: "panel",
                        layout: "fit",
                        flex: 1,
                        collapsible: false,
                        border: false,
                        items: [Ext.create(ReactComponent,{
                            componentClass: config.componentClass,
                            props: config.props,
                            autoScroll: true, // Show scrollbars if the content overflows. This does not work in a panel, this is why we use a component
                        })]
                    }
                ],
            }
        ];



        callParent(ReactPanel, this, "constructor", [config]);
    }

});
