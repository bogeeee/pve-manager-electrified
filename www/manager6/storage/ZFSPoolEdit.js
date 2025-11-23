Ext.define('PVE.storage.ZFSPoolSelector', {
    extend: 'PVE.form.ComboBoxSetStoreNode',
    alias: 'widget.pveZFSPoolSelector',
    valueField: 'pool',
    displayField: 'pool',
    queryMode: 'local',
    editable: false,
    allowBlank: false,

    listConfig: {
        columns: [
            {
                dataIndex: 'pool',
                flex: 1,
            },
        ],
        emptyText: PVE.Utils.renderNotFound(gettext('ZFS Pool')),
    },

    config: {
        apiSuffix: '/scan/zfs',
    },

    showNodeSelector: true,

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
            autoLoad: {}, // true,
            fields: ['pool', 'size', 'free'],
            proxy: {
                type: 'proxmox',
                url: `${me.apiBaseUrl}${me.nodename}${me.apiSuffix}`,
            },
        });
        store.sort('pool', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.ZFSPoolInputPanel', {
    extend: 'PVE.panel.StorageBase',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'storage_zfspool',

    column1: [
        {
            xtype: 'pmxDisplayEditField',
            cbind: {
                editable: '{isCreate}',
            },

            name: 'pool',
            fieldLabel: gettext('ZFS Pool'),
            allowBlank: false,

            editConfig: {
                xtype: 'pveZFSPoolSelector',
                reference: 'zfsPoolSelector',
                listeners: {
                    nodechanged: function (value) {
                        this.up('inputpanel').lookup('storageNodeRestriction').setValue(value);
                    },
                },
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

    column2: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'sparse',
            checked: false,
            uncheckedValue: 0,
            fieldLabel: gettext('Thin provision'),
        },
        {
            xtype: 'textfield',
            name: 'blocksize',
            emptyText: '16k',
            fieldLabel: gettext('Block Size'),
            allowBlank: true,
        },
    ],
});
