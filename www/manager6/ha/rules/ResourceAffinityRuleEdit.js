Ext.define('PVE.ha.rules.ResourceAffinityInputPanel', {
    extend: 'PVE.ha.RuleInputPanel',

    initComponent: function () {
        let me = this;

        me.column1 = [];

        me.column2 = [
            {
                xtype: 'proxmoxKVComboBox',
                name: 'affinity',
                fieldLabel: gettext('Affinity'),
                allowBlank: false,
                comboItems: [
                    ['positive', gettext('Keep Together')],
                    ['negative', gettext('Keep Separate')],
                ],
            },
        ];

        me.callParent();
    },
});
