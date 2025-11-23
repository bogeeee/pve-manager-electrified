Ext.define('PVE.window.DirMapEditWindow', {
    extend: 'Proxmox.window.Edit',

    mixins: ['Proxmox.Mixin.CBind'],

    cbindData: function (initialConfig) {
        let me = this;
        me.isCreate = !me.name;
        me.method = me.isCreate ? 'POST' : 'PUT';
        me.hideMapping = !!me.entryOnly;
        me.hideComment = me.name && !me.entryOnly;
        me.hideNodeSelector = me.nodename || me.entryOnly;
        me.hideNode = !me.nodename || !me.hideNodeSelector;
        return {
            name: me.name,
            nodename: me.nodename,
        };
    },

    submitUrl: function (_url, data) {
        let me = this;
        let name = me.isCreate ? '' : me.name;
        return `/cluster/mapping/dir/${name}`;
    },

    title: gettext('Add Directory Mapping'),

    onlineHelp: 'resource_mapping',

    method: 'POST',

    controller: {
        xclass: 'Ext.app.ViewController',

        onGetValues: function (values) {
            let me = this;
            let view = me.getView();
            values.node ??= view.nodename;

            let name = values.name;
            let description = values.description;
            let deletes = values.delete;

            delete values.description;
            delete values.name;
            delete values.delete;

            let map = [];
            if (me.originalMap) {
                map = PVE.Parser.filterPropertyStringList(
                    me.originalMap,
                    (e) => e.node !== values.node,
                );
            }
            if (values.path) {
                // TODO: Remove this when property string supports quotation of properties
                if (!/^\/[^;,=()]+/.test(values.path)) {
                    let errMsg =
                        'Value does not look like a valid absolute path.' +
                        ' These symbols are currently not allowed in path: ;,=()\n';
                    Ext.Msg.alert(gettext('Error'), errMsg);
                    // prevent sending a broken property string to the API
                    throw errMsg;
                }
                map.push(PVE.Parser.printPropertyString(values));
            }
            values = { map };

            if (description) {
                values.description = description;
            }
            if (deletes && !view.isCreate) {
                values.delete = deletes;
            }
            if (view.isCreate) {
                values.id = name;
            }

            return values;
        },

        onSetValues: function (values) {
            let me = this;
            let view = me.getView();
            me.originalMap = [...values.map];
            let configuredNodes = [];
            PVE.Parser.filterPropertyStringList(values.map, (e) => {
                configuredNodes.push(e.node);
                if (e.node === view.nodename) {
                    values = e;
                }
                return false;
            });

            me.lookup('nodeselector').disallowedNodes = configuredNodes;

            return values;
        },

        init: function (view) {
            let _me = this;

            if (!view.nodename) {
                //throw "no nodename given";
            }
        },
    },

    items: [
        {
            xtype: 'inputpanel',
            onGetValues: function (values) {
                return this.up('window').getController().onGetValues(values);
            },

            onSetValues: function (values) {
                return this.up('window').getController().onSetValues(values);
            },

            columnT: [
                {
                    xtype: 'displayfield',
                    reference: 'directory-hint',
                    columnWidth: 1,
                    value: 'Make sure the directory exists.',
                    cbind: {
                        disabled: '{hideMapping}',
                        hidden: '{hideMapping}',
                    },
                    userCls: 'pmx-hint',
                },
            ],

            column1: [
                {
                    xtype: 'pmxDisplayEditField',
                    fieldLabel: gettext('Name'),
                    cbind: {
                        editable: '{!name}',
                        value: '{name}',
                        submitValue: '{isCreate}',
                    },
                    name: 'name',
                    allowBlank: false,
                },
                {
                    xtype: 'pveNodeSelector',
                    reference: 'nodeselector',
                    fieldLabel: gettext('Node'),
                    name: 'node',
                    cbind: {
                        disabled: '{hideNodeSelector}',
                        hidden: '{hideNodeSelector}',
                    },
                    allowBlank: false,
                },
            ],

            column2: [
                {
                    xtype: 'fieldcontainer',
                    defaultType: 'radiofield',
                    layout: 'fit',
                    cbind: {
                        disabled: '{hideMapping}',
                        hidden: '{hideMapping}',
                    },
                    items: [
                        {
                            xtype: 'textfield',
                            name: 'path',
                            reference: 'path',
                            value: '',
                            emptyText: gettext('/some/path'),
                            cbind: {
                                nodename: '{nodename}',
                                disabled: '{hideMapping}',
                            },
                            allowBlank: false,
                            fieldLabel: gettext('Path'),
                        },
                    ],
                },
            ],

            columnB: [
                {
                    xtype: 'fieldcontainer',
                    defaultType: 'radiofield',
                    layout: 'fit',
                    cbind: {
                        disabled: '{hideComment}',
                        hidden: '{hideComment}',
                    },
                    items: [
                        {
                            xtype: 'proxmoxtextfield',
                            fieldLabel: gettext('Comment'),
                            submitValue: true,
                            name: 'description',
                            deleteEmpty: true,
                        },
                    ],
                },
            ],
        },
    ],
});
