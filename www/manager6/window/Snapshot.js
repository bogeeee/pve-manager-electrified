Ext.define('PVE.window.Snapshot', {
    extend: 'Proxmox.window.Edit',

    viewModel: {
        data: {
            type: undefined,
            isCreate: undefined,
            running: false,
            guestAgentEnabled: false,
        },
        formulas: {
            runningWithoutGuestAgent: (get) =>
                get('type') === 'qemu' && get('running') && !get('guestAgentEnabled'),
            shouldWarnAboutFS: (get) =>
                get('isCreate') && get('runningWithoutGuestAgent') && get('!vmstate.checked'),
        },
    },

    onGetValues: function (values) {
        let me = this;

        if (me.type === 'lxc') {
            delete values.vmstate;
        }

        return values;
    },

    initComponent: function () {
        var me = this;
        var vm = me.getViewModel();

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        if (!me.type) {
            throw 'no type specified';
        }

        vm.set('type', me.type);
        vm.set('running', me.running);
        vm.set('isCreate', me.isCreate);

        if (me.type === 'qemu' && me.isCreate) {
            Proxmox.Utils.API2Request({
                url: `/nodes/${me.nodename}/${me.type}/${me.vmid}/config`,
                params: { current: '1' },
                method: 'GET',
                success: function (response, options) {
                    let res = response.result.data;
                    let enabled = PVE.Parser.parsePropertyString(res.agent, 'enabled');
                    vm.set('guestAgentEnabled', !!PVE.Parser.parseBoolean(enabled.enabled));
                },
            });
        }

        me.items = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'snapname',
                value: me.snapname,
                fieldLabel: gettext('Name'),
                vtype: 'ConfigId',
                allowBlank: false,
            },
            {
                xtype: 'displayfield',
                hidden: me.isCreate,
                disabled: me.isCreate,
                name: 'snaptime',
                renderer: PVE.Utils.render_timestamp_human_readable,
                fieldLabel: gettext('Timestamp'),
            },
            {
                xtype: 'proxmoxcheckbox',
                hidden: me.type !== 'qemu' || !me.isCreate || !me.running,
                disabled: me.type !== 'qemu' || !me.isCreate || !me.running,
                name: 'vmstate',
                reference: 'vmstate',
                uncheckedValue: 0,
                defaultValue: 0,
                checked: 1,
                fieldLabel: gettext('Include RAM'),
            },
            {
                xtype: 'textareafield',
                grow: true,
                editable: !me.viewonly,
                name: 'description',
                fieldLabel: gettext('Description'),
            },
            {
                xtype: 'displayfield',
                userCls: 'pmx-hint',
                name: 'fswarning',
                hidden: true,
                value: gettext(
                    'It is recommended to either include the RAM or use the QEMU Guest Agent when taking a snapshot of a running VM to avoid inconsistencies.',
                ),
                bind: {
                    hidden: '{!shouldWarnAboutFS}',
                },
            },
            {
                title: gettext('Settings'),
                hidden: me.isCreate,
                xtype: 'grid',
                itemId: 'summary',
                border: true,
                height: 200,
                store: {
                    model: 'KeyValue',
                    sorters: [
                        {
                            property: 'key',
                            direction: 'ASC',
                        },
                    ],
                },
                columns: [
                    {
                        header: gettext('Key'),
                        width: 150,
                        dataIndex: 'key',
                    },
                    {
                        header: gettext('Value'),
                        flex: 1,
                        dataIndex: 'value',
                    },
                ],
            },
        ];

        me.url = `/nodes/${me.nodename}/${me.type}/${me.vmid}/snapshot`;

        let subject;
        if (me.isCreate) {
            let guestTypeStr = me.type === 'qemu' ? 'VM' : 'CT';
            let formattedGuestIdentifier = PVE.Utils.getFormattedGuestIdentifier(
                me.vmid,
                me.vmname,
            );
            subject = `${guestTypeStr} ${formattedGuestIdentifier} ${gettext('Snapshot')}`;
            me.method = 'POST';
            me.showTaskViewer = true;
        } else {
            subject = `${gettext('Snapshot')} ${me.snapname}`;
            me.url += `/${me.snapname}/config`;
        }

        Ext.apply(me, {
            subject: subject,
            width: me.isCreate ? 450 : 620,
            height: me.isCreate ? undefined : 420,
        });

        me.callParent();

        if (!me.snapname) {
            return;
        }

        me.load({
            success: function (response) {
                let kvarray = [];
                Ext.Object.each(response.result.data, function (key, value) {
                    if (key === 'description' || key === 'snaptime') {
                        return;
                    }
                    kvarray.push({ key: key, value: value });
                });

                let summarystore = me.down('#summary').getStore();
                summarystore.suspendEvents();
                summarystore.add(kvarray);
                summarystore.sort();
                summarystore.resumeEvents();
                summarystore.fireEvent('refresh', summarystore);

                me.setValues(response.result.data);
            },
        });
    },
});
