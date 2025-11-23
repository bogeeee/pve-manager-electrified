Ext.define('PVE.storage.TPoolSelector', {
    extend: 'PVE.form.ComboBoxSetStoreNode',
    alias: 'widget.pveTPSelector',

    queryParam: 'vg',
    valueField: 'lv',
    displayField: 'lv',
    editable: false,
    allowBlank: false,

    listConfig: {
        emptyText: PVE.Utils.renderNotFound('Thin-Pool'),
        columns: [
            {
                dataIndex: 'lv',
                flex: 1,
            },
        ],
    },

    config: {
        apiSuffix: '/scan/lvmthin',
    },

    reload: function () {
        let me = this;
        if (!me.isDisabled()) {
            me.getStore().load();
        }
    },

    setVG: function (myvg) {
        let me = this;
        me.vg = myvg;
        me.getStore().getProxy().setExtraParams({ vg: myvg });
        me.reload();
    },

    setNodeName: function (value) {
        let me = this;
        me.callParent([value]);
        me.reload();
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }

        let store = Ext.create('Ext.data.Store', {
            fields: ['lv'],
            proxy: {
                type: 'proxmox',
                url: `${me.apiBaseUrl}${me.nodename}${me.apiSuffix}`,
            },
        });

        store.sort('lv', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.BaseVGSelector', {
    extend: 'PVE.form.ComboBoxSetStoreNode',
    alias: 'widget.pveBaseVGSelector',

    valueField: 'vg',
    displayField: 'vg',
    queryMode: 'local',
    editable: false,
    allowBlank: false,

    listConfig: {
        columns: [
            {
                dataIndex: 'vg',
                flex: 1,
            },
        ],
    },

    showNodeSelector: true,

    config: {
        apiSuffix: '/scan/lvm',
    },

    setNodeName: function (value) {
        let me = this;
        me.callParent([value]);
        me.getStore().load();
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }

        let store = Ext.create('Ext.data.Store', {
            autoLoad: {},
            fields: ['vg', 'size', 'free'],
            proxy: {
                type: 'proxmox',
                url: `${me.apiBaseUrl}${me.nodename}${me.apiSuffix}`,
            },
        });

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.LvmThinInputPanel', {
    extend: 'PVE.panel.StorageBase',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'storage_lvmthin',

    column1: [
        {
            xtype: 'pmxDisplayEditField',
            cbind: {
                editable: '{isCreate}',
            },

            name: 'vgname',
            fieldLabel: gettext('Volume group'),

            editConfig: {
                xtype: 'pveBaseVGSelector',
                listeners: {
                    nodechanged: function (value) {
                        let panel = this.up('inputpanel');
                        panel.lookup('thinPoolSelector').setNodeName(value);
                        panel.lookup('storageNodeRestriction').setValue(value);
                    },
                    change: function (f, value) {
                        let vgField = this.up('inputpanel').lookup('thinPoolSelector');
                        if (vgField && !f.isDisabled()) {
                            vgField.setDisabled(!value);
                            vgField.setVG(value);
                            vgField.setValue('');
                        }
                    },
                },
            },
        },
        {
            xtype: 'pmxDisplayEditField',
            cbind: {
                editable: '{isCreate}',
            },

            name: 'thinpool',
            fieldLabel: gettext('Thin Pool'),
            allowBlank: false,

            editConfig: {
                xtype: 'pveTPSelector',
                reference: 'thinPoolSelector',
                disabled: true,
            },
        },
        {
            xtype: 'pveContentTypeSelector',
            cts: ['images', 'rootdir'],
            fieldLabel: gettext('Content'),
            name: 'content',
            value: ['images', 'rootdir'],
            multiSelect: true,
            allowBlank: false,
        },
    ],
});
