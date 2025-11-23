Ext.define('PVE.window.PCIMapEditWindow', {
    extend: 'Proxmox.window.Edit',

    mixins: ['Proxmox.Mixin.CBind'],

    width: 800,

    subject: gettext('PCI mapping'),

    onlineHelp: 'resource_mapping',

    method: 'POST',

    cbindData: function (initialConfig) {
        let me = this;
        me.isCreate = (!me.name || !me.nodename) && !me.entryOnly;
        me.method = me.name ? 'PUT' : 'POST';
        me.hideMapping = !!me.entryOnly;
        me.globalEdit = !me.name || me.entryOnly;
        me.hideNodeSelector = me.nodename || me.entryOnly;
        me.hideNode = !me.nodename || !me.hideNodeSelector;
        return {
            name: me.name,
            nodename: me.nodename,
        };
    },

    submitUrl: function (_url, data) {
        let me = this;
        let name = me.method === 'PUT' ? me.name : '';
        return `/cluster/mapping/pci/${name}`;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        onGetValues: function (values) {
            let me = this;
            let view = me.getView();
            if (view.method === 'POST') {
                delete me.digest;
            }

            if (values.iommugroup === -1) {
                delete values.iommugroup;
            }

            let nodename = values.node ?? view.nodename;
            delete values.node;
            if (me.originalMap) {
                let otherMaps = PVE.Parser.filterPropertyStringList(
                    me.originalMap,
                    (e) => e.node !== nodename,
                );
                if (otherMaps.length) {
                    values.map = values.map.concat(otherMaps);
                }
            }

            return values;
        },

        onSetValues: function (values) {
            let me = this;
            let view = me.getView();
            me.originalMap = [...values.map];
            let configuredNodes = [];
            values.map = PVE.Parser.filterPropertyStringList(values.map, (e) => {
                configuredNodes.push(e.node);
                return e.node === view.nodename;
            });

            me.lookup('nodeselector').disallowedNodes = configuredNodes;
            return values;
        },

        checkIommu: function (store, records, success) {
            let me = this;
            if (!success || !records.length) {
                return;
            }
            me.lookup('iommu_warning').setVisible(
                records.every((val) => val.data.iommugroup === -1),
            );

            let value = me.lookup('pciselector').getValue();
            me.checkIsolated(value);
        },

        checkIsolated: function (value) {
            let me = this;

            let store = me.lookup('pciselector').getStore();

            let isIsolated = function (entry) {
                let isolated = true;
                let parsed = PVE.Parser.parsePropertyString(entry);
                parsed.iommugroup = parseInt(parsed.iommugroup, 10);
                if (!parsed.iommugroup) {
                    return isolated;
                }
                store.each(({ data }) => {
                    let isSubDevice = data.id.startsWith(parsed.path);
                    if (
                        data.iommugroup === parsed.iommugroup &&
                        data.id !== parsed.path &&
                        !isSubDevice
                    ) {
                        isolated = false;
                        return false;
                    }
                    return true;
                });
                return isolated;
            };

            let showWarning = false;
            if (Ext.isArray(value)) {
                for (const entry of value) {
                    if (!isIsolated(entry)) {
                        showWarning = true;
                        break;
                    }
                }
            } else {
                showWarning = isIsolated(value);
            }
            me.lookup('group_warning').setVisible(showWarning);
        },

        mdevChange: function (mdevField, value) {
            this.lookup('pciselector').setMdev(value);
        },

        nodeChange: function (field, value) {
            if (!field.isDisabled()) {
                this.lookup('pciselector').setNodename(value);
            }
        },

        pciChange: function (_field, value) {
            let me = this;
            me.lookup('multiple_warning').setVisible(Ext.isArray(value) && value.length > 1);
            me.checkIsolated(value);
        },

        control: {
            'field[name=mdev]': {
                change: 'mdevChange',
            },
            pveNodeSelector: {
                change: 'nodeChange',
            },
            pveMultiPCISelector: {
                change: 'pciChange',
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

            columnT: [
                {
                    xtype: 'displayfield',
                    reference: 'iommu_warning',
                    hidden: true,
                    columnWidth: 1,
                    padding: '0 0 10 0',
                    value: gettext(
                        'No IOMMU detected, please activate it. See Documentation for further information.',
                    ),
                    userCls: 'pmx-hint',
                },
                {
                    xtype: 'displayfield',
                    reference: 'multiple_warning',
                    hidden: true,
                    columnWidth: 1,
                    padding: '0 0 10 0',
                    value: gettext(
                        'When multiple devices are selected, the first free one will be chosen on guest start.',
                    ),
                    userCls: 'pmx-hint',
                },
                {
                    xtype: 'displayfield',
                    reference: 'group_warning',
                    hidden: true,
                    columnWidth: 1,
                    padding: '0 0 10 0',
                    itemId: 'iommuwarning',
                    value: gettext(
                        'A selected device is not in a separate IOMMU group, make sure this is intended.',
                    ),
                    userCls: 'pmx-hint',
                },
            ],

            column1: [
                {
                    xtype: 'pmxDisplayEditField',
                    fieldLabel: gettext('Name'),
                    labelWidth: 120,
                    cbind: {
                        editable: '{!name}',
                        value: '{name}',
                        submitValue: '{isCreate}',
                    },
                    name: 'id',
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
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('Use with Mediated Devices'),
                    labelWidth: 200,
                    reference: 'mdev',
                    name: 'mdev',
                    cbind: {
                        deleteEmpty: '{!isCreate}',
                        disabled: '{!globalEdit}',
                    },
                },
                {
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('Live Migration Capable'),
                    labelWidth: 200,
                    boxLabel: `<i class="fa fa-exclamation-triangle warning"></i> ${gettext('Experimental')}`,
                    reference: 'live-migration-capable',
                    name: 'live-migration-capable',
                    cbind: {
                        deleteEmpty: '{!isCreate}',
                        disabled: '{!globalEdit}',
                    },
                },
            ],

            columnB: [
                {
                    xtype: 'pveMultiPCISelector',
                    fieldLabel: gettext('Device'),
                    labelWidth: 120,
                    height: 300,
                    reference: 'pciselector',
                    name: 'map',
                    cbind: {
                        nodename: '{nodename}',
                        disabled: '{hideMapping}',
                        hidden: '{hideMapping}',
                    },
                    allowBlank: false,
                    onLoadCallBack: 'checkIommu',
                    margin: '0 0 10 0',
                },
                {
                    xtype: 'proxmoxtextfield',
                    fieldLabel: gettext('Comment'),
                    labelWidth: 120,
                    submitValue: true,
                    name: 'description',
                    cbind: {
                        deleteEmpty: '{!isCreate}',
                        disabled: '{!globalEdit}',
                        hidden: '{!globalEdit}',
                    },
                },
            ],
        },
    ],
});
