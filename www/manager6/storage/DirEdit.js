Ext.define('PVE.storage.DirInputPanel', {
    extend: 'PVE.panel.StorageBase',

    onlineHelp: 'storage_directory',

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'path',
                value: '',
                fieldLabel: gettext('Directory'),
                allowBlank: false,
            },
            {
                xtype: 'pveContentTypeSelector',
                name: 'content',
                value: 'images',
                multiSelect: true,
                fieldLabel: gettext('Content'),
                allowBlank: false,
            },
        ];

        me.column2 = [
            {
                xtype: 'proxmoxcheckbox',
                name: 'shared',
                uncheckedValue: 0,
                fieldLabel: gettext('Shared'),
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Enable if the underlying file system is already shared between nodes.',
                    ),
                },
            },
        ];

        me.callParent();
    },
});
