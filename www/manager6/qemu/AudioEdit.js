Ext.define('PVE.qemu.AudioInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveAudioInputPanel',

    onlineHelp: 'qm_audio_device',

    onGetValues: function (values) {
        var ret = PVE.Parser.printPropertyString(values);
        if (ret === '') {
            return {
                delete: 'audio0',
            };
        }
        return {
            audio0: ret,
        };
    },

    items: [
        {
            name: 'device',
            xtype: 'proxmoxKVComboBox',
            value: 'ich9-intel-hda',
            fieldLabel: gettext('Audio Device'),
            comboItems: [
                ['ich9-intel-hda', 'ich9-intel-hda'],
                ['intel-hda', 'intel-hda'],
                ['AC97', 'AC97'],
            ],
        },
        {
            name: 'driver',
            xtype: 'proxmoxKVComboBox',
            value: 'spice',
            fieldLabel: gettext('Backend Driver'),
            comboItems: [
                ['spice', 'SPICE'],
                ['none', `${Proxmox.Utils.NoneText} (${gettext('Dummy Device')})`],
            ],
        },
    ],
});

Ext.define('PVE.qemu.AudioEdit', {
    extend: 'Proxmox.window.Edit',

    vmconfig: undefined,

    subject: gettext('Audio Device'),

    items: [
        {
            xtype: 'pveAudioInputPanel',
        },
    ],

    initComponent: function () {
        var me = this;

        me.callParent();

        me.load({
            success: function (response) {
                me.vmconfig = response.result.data;

                var audio0 = me.vmconfig.audio0;
                if (audio0) {
                    me.setValues(PVE.Parser.parsePropertyString(audio0));
                }
            },
        });
    },
});
