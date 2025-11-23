Ext.define('PVE.window.USBMapEditWindow', {
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
        return `/cluster/mapping/usb/${name}`;
    },

    title: gettext('Add USB mapping'),

    onlineHelp: 'resource_mapping',

    method: 'POST',

    controller: {
        xclass: 'Ext.app.ViewController',

        onGetValues: function (values) {
            let me = this;
            let view = me.getView();
            values.node ??= view.nodename;

            let type = me.getView().down('radiofield').getGroupValue();
            let name = values.name;
            let description = values.description;
            delete values.description;
            delete values.name;

            if (type === 'path') {
                let usbsel = me.lookup(type);
                let usbDev = usbsel
                    .getStore()
                    .findRecord('usbid', values[type], 0, false, true, true);

                if (!usbDev) {
                    return {};
                }
                values.id = `${usbDev.data.vendid}:${usbDev.data.prodid}`;
            }

            let map = [];
            if (me.originalMap) {
                map = PVE.Parser.filterPropertyStringList(
                    me.originalMap,
                    (e) => e.node !== values.node,
                );
            }
            if (values.id) {
                map.push(PVE.Parser.printPropertyString(values));
            }

            values = { map };
            if (description) {
                values.description = description;
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
            if (values.path) {
                values.usb = 'path';
            }

            return values;
        },

        modeChange: function (field, value) {
            let me = this;
            let type = field.inputValue;
            let usbsel = me.lookup(type);
            usbsel.setDisabled(!value);
        },

        nodeChange: function (field, value) {
            if (!field.isDisabled()) {
                this.lookup('id').setNodename(value);
                this.lookup('path').setNodename(value);
            }
        },

        init: function (view) {
            let _me = this;

            if (!view.nodename) {
                //throw "no nodename given";
            }
        },

        control: {
            radiofield: {
                change: 'modeChange',
            },
            pveNodeSelector: {
                change: 'nodeChange',
            },
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
                    xtype: 'displayfield',
                    fieldLabel: gettext('Mapping on Node'),
                    labelWidth: 120,
                    name: 'node',
                    cbind: {
                        value: '{nodename}',
                        disabled: '{hideNode}',
                        hidden: '{hideNode}',
                    },
                    allowBlank: false,
                },
                {
                    xtype: 'pveNodeSelector',
                    reference: 'nodeselector',
                    fieldLabel: gettext('Mapping on Node'),
                    labelWidth: 120,
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
                            name: 'usb',
                            inputValue: 'id',
                            checked: true,
                            boxLabel: gettext('Use USB Vendor/Device ID'),
                            submitValue: false,
                        },
                        {
                            xtype: 'pveUSBSelector',
                            type: 'device',
                            reference: 'id',
                            name: 'id',
                            cbind: {
                                nodename: '{nodename}',
                                disabled: '{hideMapping}',
                            },
                            editable: true,
                            allowBlank: false,
                            fieldLabel: gettext('Choose Device'),
                            labelAlign: 'right',
                        },
                        {
                            name: 'usb',
                            inputValue: 'path',
                            boxLabel: gettext('Use USB Port'),
                            submitValue: false,
                        },
                        {
                            xtype: 'pveUSBSelector',
                            disabled: true,
                            name: 'path',
                            reference: 'path',
                            cbind: {
                                nodename: '{nodename}',
                            },
                            editable: true,
                            type: 'port',
                            allowBlank: false,
                            fieldLabel: gettext('Choose Port'),
                            labelAlign: 'right',
                        },
                    ],
                },
            ],

            columnB: [
                {
                    xtype: 'proxmoxtextfield',
                    fieldLabel: gettext('Comment'),
                    submitValue: true,
                    name: 'description',
                    cbind: {
                        disabled: '{hideComment}',
                        hidden: '{hideComment}',
                    },
                },
            ],
        },
    ],
});
