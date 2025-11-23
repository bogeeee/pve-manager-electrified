Ext.define('PVE.storage.BTRFSInputPanel', {
    extend: 'PVE.panel.StorageBase',

    onlineHelp: 'storage_btrfs',

    initComponent: function () {
        let me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'path',
                value: '',
                fieldLabel: gettext('Path'),
                allowBlank: false,
            },
            {
                xtype: 'pveContentTypeSelector',
                name: 'content',
                value: ['images', 'rootdir'],
                multiSelect: true,
                fieldLabel: gettext('Content'),
                allowBlank: false,
            },
        ];

        me.columnB = [
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                value: `BTRFS integration is currently a technology preview.`,
            },
        ];

        me.callParent();
    },
});
