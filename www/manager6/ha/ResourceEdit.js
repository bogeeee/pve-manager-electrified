Ext.define('PVE.ha.VMResourceInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    onlineHelp: 'ha_manager_resource_config',
    vmid: undefined,

    onGetValues: function (values) {
        var me = this;

        if (values.vmid) {
            values.sid = values.vmid;
        }
        delete values.vmid;

        PVE.Utils.delete_if_default(values, 'failback', '1', me.isCreate);
        PVE.Utils.delete_if_default(values, 'max_restart', '1', me.isCreate);
        PVE.Utils.delete_if_default(values, 'max_relocate', '1', me.isCreate);

        return values;
    },

    initComponent: function () {
        var me = this;
        var MIN_QUORUM_VOTES = 3;

        var disabledHint = Ext.createWidget({
            xtype: 'displayfield', // won't get submitted by default
            userCls: 'pmx-hint',
            value:
                'Disabling the resource will stop the guest system. ' +
                'See the online help for details.',
            hidden: true,
        });

        var fewVotesHint = Ext.createWidget({
            itemId: 'fewVotesHint',
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: 'At least three quorum votes are recommended for reliable HA.',
            hidden: true,
        });

        Proxmox.Utils.API2Request({
            url: '/cluster/config/nodes',
            method: 'GET',
            failure: function (response) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
            success: function (response) {
                var nodes = response.result.data;
                var votes = 0;
                Ext.Array.forEach(nodes, function (node) {
                    var vote = parseInt(node.quorum_votes, 10); // parse as base 10
                    votes += vote || 0; // parseInt might return NaN, which is false
                });

                if (votes < MIN_QUORUM_VOTES) {
                    fewVotesHint.setVisible(true);
                }
            },
        });

        var vmidStore = me.vmid
            ? {}
            : {
                  model: 'PVEResources',
                  autoLoad: true,
                  sorters: 'vmid',
                  filters: [
                      {
                          property: 'type',
                          value: /lxc|qemu/,
                      },
                      {
                          property: 'hastate',
                          value: /unmanaged/,
                      },
                  ],
              };

        // value is a string above, but a number below
        me.column1 = [
            {
                xtype: me.vmid ? 'displayfield' : 'vmComboSelector',
                submitValue: me.isCreate,
                name: 'vmid',
                fieldLabel: me.vmid && me.guestType === 'ct' ? 'CT' : 'VM',
                value: me.vmid,
                store: vmidStore,
                allowBlank: false,
                validateExists: true,
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'max_restart',
                fieldLabel: gettext('Max. Restart'),
                value: 1,
                minValue: 0,
                maxValue: 10,
                allowBlank: false,
            },
            {
                xtype: 'proxmoxintegerfield',
                name: 'max_relocate',
                fieldLabel: gettext('Max. Relocate'),
                value: 1,
                minValue: 0,
                maxValue: 10,
                allowBlank: false,
            },
        ];

        me.column2 = [
            {
                xtype: 'proxmoxcheckbox',
                name: 'failback',
                fieldLabel: gettext('Failback'),
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Enable if HA resource should automatically adjust to HA rules.',
                    ),
                },
                uncheckedValue: 0,
                value: 1,
            },
            {
                xtype: 'proxmoxKVComboBox',
                name: 'state',
                value: 'started',
                fieldLabel: gettext('Request State'),
                comboItems: [
                    ['started', 'started'],
                    ['stopped', 'stopped'],
                    ['ignored', 'ignored'],
                    ['disabled', 'disabled'],
                ],
                listeners: {
                    change: function (field, newValue) {
                        if (newValue === 'disabled') {
                            disabledHint.setVisible(true);
                        } else if (disabledHint.isVisible()) {
                            disabledHint.setVisible(false);
                        }
                    },
                },
            },
            disabledHint,
        ];

        me.columnB = [
            {
                xtype: 'textfield',
                name: 'comment',
                fieldLabel: gettext('Comment'),
            },
            fewVotesHint,
        ];

        me.callParent();
    },
});

Ext.define('PVE.ha.VMResourceEdit', {
    extend: 'Proxmox.window.Edit',

    vmid: undefined,
    guestType: undefined,
    isCreate: undefined,
    defaultFocus: undefined,

    initComponent: function () {
        var me = this;

        if (me.isCreate === undefined) {
            me.isCreate = !me.vmid;
        }

        if (me.isCreate) {
            me.url = '/api2/extjs/cluster/ha/resources';
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs/cluster/ha/resources/' + me.vmid;
            me.method = 'PUT';
        }

        var ipanel = Ext.create('PVE.ha.VMResourceInputPanel', {
            isCreate: me.isCreate,
            vmid: me.vmid,
            guestType: me.guestType,
        });

        Ext.apply(me, {
            subject:
                gettext('Resource') +
                ': ' +
                gettext('Container') +
                '/' +
                gettext('Virtual Machine'),
            isAdd: true,
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var values = response.result.data;

                    var regex = /^(\S+):(\S+)$/;
                    var res = regex.exec(values.sid);

                    if (res[1] !== 'vm' && res[1] !== 'ct') {
                        throw 'got unexpected resource type';
                    }

                    values.vmid = res[2];

                    ipanel.setValues(values);
                },
            });
        }
    },
});
